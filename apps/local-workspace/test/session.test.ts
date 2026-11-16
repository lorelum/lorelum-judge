import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateWorkflowSessionEvent,
  validateWorkflowSessionEvents,
} from "@lorelum/judge-protocol";
import { SessionRouter } from "../src/session.js";

type State = {
  sessionId: string;
  sequence: number;
  model: { mode: string; recipient: string } | null;
  plan: { identity: string; revision: number; status: string; eligible: boolean } | null;
  disclosure: { identity: string; request: { instructions: string }; authorized: boolean } | null;
  execution: { status: string; proposal: unknown };
};
type Response = { ok: boolean; state: State; error?: { message: string } };
const task = {
  schema: "lorelum.judge.task-contract/v1",
  id: "task",
  taskClass: "code",
  text: "Update the note",
};
const sources = [
  {
    id: "request",
    kind: "user",
    locator: "user",
    version: "1",
    content: task.text,
    status: "available",
  },
];
const offline = {
  targetPath: "note.txt",
  replacement: "new text",
  checkDescription: "Run the check",
};
const call = async (session: SessionRouter, action: string, payload: unknown): Promise<Response> =>
  (await session.dispatch(action, payload)) as Response;

async function createPlan(session: SessionRouter): Promise<State> {
  expect((await call(session, "model.offline", offline)).ok).toBe(true);
  expect(
    (await call(session, "planning.create", { id: "plan", inputs: { task, sources } })).ok,
  ).toBe(true);
  const preview = await call(session, "planning.preview", { instructions: "Keep it focused" });
  expect(preview.ok).toBe(true);
  const identity = preview.state.disclosure!.identity;
  expect(preview.state.disclosure!.request.instructions).toBe("Keep it focused");
  expect((await call(session, "planning.generate", { identity })).ok).toBe(false);
  expect((await call(session, "planning.authorize", { identity })).ok).toBe(true);
  const generated = await call(session, "planning.generate", { identity });
  expect(generated.ok).toBe(true);
  return generated.state;
}

describe("local workspace session router", () => {
  test("requires a request-bound decision and explicit plan confirmation", async () => {
    const session = new SessionRouter();
    const state = await createPlan(session);
    expect(state.plan?.status).toBe("draft");
    expect(state.plan?.eligible).toBe(false);
    const identity = state.plan!.identity;
    const revision = state.plan!.revision;
    expect((await call(session, "planning.confirm", { identity, revision: revision + 1 })).ok).toBe(
      false,
    );
    const confirmed = await call(session, "planning.confirm", { identity, revision });
    expect(confirmed.state.plan?.eligible).toBe(true);
    expect(confirmed.state.execution.status).toBe("idle");
    const rejected = await call(session, "planning.reject", {});
    expect(rejected.state.plan?.status).toBe("revoked");
  });

  test("a changed model invalidates a pending disclosure and an approved plan", async () => {
    const session = new SessionRouter();
    const state = await createPlan(session);
    await call(session, "planning.confirm", {
      identity: state.plan!.identity,
      revision: state.plan!.revision,
    });
    const preview = await call(session, "planning.preview", { instructions: "adjust" });
    const old = preview.state.disclosure!.identity;
    const changed = await call(session, "model.offline", { ...offline, replacement: "different" });
    expect(changed.state.plan?.eligible).toBe(false);
    expect(changed.state.disclosure).toBeNull();
    expect((await call(session, "planning.authorize", { identity: old })).ok).toBe(false);
  });

  test("emits only validated ordered metadata and isolates listeners", async () => {
    const session = new SessionRouter();
    const events: unknown[] = [];
    session.subscribe(() => {
      throw new Error("observer must not interrupt");
    });
    const unsubscribe = session.subscribe((event) => events.push(event));
    await createPlan(session);
    unsubscribe();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => validateWorkflowSessionEvent(event).ok)).toBe(true);
    expect(validateWorkflowSessionEvents(events).ok).toBe(true);
    expect(JSON.stringify(events)).not.toContain("new text");
    expect(JSON.stringify(events)).not.toContain("Keep it focused");
    const count = events.length;
    await call(session, "planning.reject", {});
    expect(events).toHaveLength(count);
  });

  test("does not accept functions, restore capabilities, or expose host secrets", async () => {
    const secret = "a-private-api-key";
    const session = new SessionRouter({
      configuredModel: {
        endpoint: "https://example.com/v1",
        apiKey: secret,
        config: { model: "example" },
      },
    });
    const selected = await call(session, "model.configured", {});
    expect(selected.ok).toBe(true);
    expect(selected.state.model?.mode).toBe("configured");
    const invalid = await call(session, "planning.create", {
      id: "plan",
      inputs: { task, sources },
      callback: () => {},
    });
    expect(invalid.ok).toBe(false);
    expect(JSON.stringify(selected)).not.toContain(secret);
    expect(JSON.stringify(invalid)).not.toContain(secret);
    expect(
      (await call(session, "execution.authorize", { identity: "fake", decisionRef: "user" })).ok,
    ).toBe(false);
    expect((await call(session, "execution.run", {})).ok).toBe(false);
  });

  test("configured provider is not called without disclosure and reports a transport failure", async () => {
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        calls++;
        return new Response("private provider error body", { status: 503 });
      },
    });
    try {
      const session = new SessionRouter({
        configuredModel: {
          endpoint: `http://127.0.0.1:${server.port}/v1`,
          apiKey: "test-secret",
          config: { model: "local-test" },
        },
      });
      await call(session, "model.configured", {});
      await call(session, "planning.create", { id: "plan", inputs: { task, sources } });
      const preview = await call(session, "planning.preview", {});
      if (!preview.state.disclosure) throw new Error("missing disclosure preview");
      const identity = preview.state.disclosure.identity;
      expect((await call(session, "planning.generate", { identity })).ok).toBe(false);
      expect(calls).toBe(0);
      expect((await call(session, "planning.authorize", { identity })).ok).toBe(true);
      const failed = await call(session, "planning.generate", { identity });
      expect(calls).toBe(1);
      expect(failed.ok).toBe(false);
      expect(failed.error?.message).toBe("Configured model request failed");
      expect(JSON.stringify(failed)).not.toContain("test-secret");
      expect(JSON.stringify(failed)).not.toContain("private provider error body");
    } finally {
      server.stop(true);
    }
  });

  test("returns safe discovery diagnostics without creating a fake workspace", async () => {
    const session = new SessionRouter();
    const result = await call(session, "workspace.discover", { root: "relative", exclusions: [] });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe("Project root must be absolute");
    expect((session.snapshot() as { workspace: unknown }).workspace).toBeNull();
  });
});

const linux = process.platform === "linux" ? describe : describe.skip;
linux("real workspace authorization", () => {
  test("discovers dirty/untracked files, excludes before review, and revokes a separate execution decision", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-session-"));
    const session = new SessionRouter();
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
      git("init");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "Test");
      await writeFile(join(root, "note.txt"), "base");
      git("add", "note.txt");
      git("commit", "-m", "base");
      await writeFile(join(root, "note.txt"), "dirty");
      await writeFile(join(root, "secret.txt"), "private");
      const discovery = await call(session, "workspace.discover", {
        root,
        exclusions: [{ path: "secret.txt", reason: "private" }],
      });
      expect(discovery.ok).toBe(true);
      const workspace = (
        session.snapshot() as {
          workspace: {
            identity: string;
            candidates: { path: string; origin: string; status: string }[];
          };
        }
      ).workspace;
      expect(workspace.candidates.find((item) => item.path === "note.txt")?.origin).toBe(
        "modified",
      );
      expect(workspace.candidates.find((item) => item.path === "secret.txt")?.status).toBe(
        "excluded",
      );
      const plan = await createPlan(session);
      await call(session, "planning.confirm", {
        identity: plan.plan!.identity,
        revision: plan.plan!.revision,
      });
      const command = { executable: "/usr/bin/true", args: [], cwd: "." };
      const proposalInput = {
        permission: {
          planIdentity: plan.plan!.identity,
          planRevision: plan.plan!.revision,
          workspaceIdentity: workspace.identity,
          readPaths: ["note.txt"],
          commandReadPaths: ["."],
          writePaths: ["note.txt"],
          writablePaths: [],
          commands: [command],
          disclosures: ["plan", "file-content", "command-output", "review"],
          modelRecipient: "offline (local deterministic model)",
          limits: {
            totalTimeMs: 30000,
            commandTimeMs: 15000,
            modelCalls: 4,
            actions: 4,
            commands: 1,
            outputBytes: 10000,
          },
          expiresAt: Date.now() + 30000,
          isolation: "bubblewrap-no-network",
        },
        verification: {
          checks: [
            {
              id: "check",
              version: "1",
              environmentIdentity: null,
              ...command,
              readPaths: ["."],
              timeoutMs: 15000,
              maxOutputBytes: 1000,
            },
          ],
        },
      };
      const proposal = await call(session, "execution.propose", proposalInput);
      expect(proposal.ok).toBe(true);
      const proposed = proposal.state.execution.proposal as { identity: string };
      expect((await call(session, "execution.run", {})).ok).toBe(false);
      expect(
        (
          await call(session, "execution.authorize", {
            identity: proposed.identity,
            decisionRef: "user-approved",
          })
        ).state.execution.status,
      ).toBe("authorized");
      expect((await call(session, "execution.cancel", {})).state.execution.status).toBe(
        "cancelled",
      );
      expect((await call(session, "execution.run", {})).ok).toBe(false);
      const second = await call(session, "execution.propose", proposalInput);
      const nextProposal = second.state.execution.proposal as { identity: string };
      expect(
        (
          await call(session, "execution.authorize", {
            identity: nextProposal.identity,
            decisionRef: "second-approval",
          })
        ).ok,
      ).toBe(true);
      type CompletedState = {
        sequence: number;
        execution: {
          status: string;
          result: { workspaceRoot: string | null; report: { checks: string } };
        };
      };
      let terminalSnapshot: CompletedState | undefined;
      session.subscribe((event) => {
        if (event && typeof event === "object" && "stage" in event && event.stage === "terminal")
          terminalSnapshot = session.snapshot() as CompletedState;
      });
      const completed = await call(session, "execution.run", {});
      const final = completed.state as unknown as CompletedState;
      expect(final.execution.status).toBe("completed");
      expect(final.execution.result.report.checks).toBe("complete");
      expect(terminalSnapshot?.sequence).toBe(final.sequence);
      expect(terminalSnapshot?.execution.result.report.checks).toBe("complete");
      expect(terminalSnapshot?.execution.status).toBe("completed");
      if (final.execution.result.workspaceRoot)
        await rm(final.execution.result.workspaceRoot, { recursive: true, force: true });
      const refreshed = await call(session, "workspace.discover", {
        root,
        exclusions: [{ path: "secret.txt", reason: "private" }],
      });
      expect(refreshed.ok).toBe(true);
      const refreshedWorkspace = (session.snapshot() as { workspace: { identity: string } })
        .workspace;
      const refreshedPlan = await createPlan(session);
      if (!refreshedPlan.plan) throw new Error("missing refreshed plan");
      await call(session, "planning.confirm", {
        identity: refreshedPlan.plan.identity,
        revision: refreshedPlan.plan.revision,
      });
      const stoppedProposal = await call(session, "execution.propose", {
        ...proposalInput,
        permission: {
          ...proposalInput.permission,
          planIdentity: refreshedPlan.plan.identity,
          planRevision: refreshedPlan.plan.revision,
          workspaceIdentity: refreshedWorkspace.identity,
          expiresAt: Date.now() + 30000,
        },
      });
      const stopIdentity = stoppedProposal.state.execution.proposal as { identity: string };
      expect(
        (
          await call(session, "execution.authorize", {
            identity: stopIdentity.identity,
            decisionRef: "stop-after-check",
          })
        ).ok,
      ).toBe(true);
      const unsubscribe = session.subscribe((event) => {
        if (
          event &&
          typeof event === "object" &&
          "stage" in event &&
          "status" in event &&
          event.stage === "check" &&
          event.status === "passed"
        )
          void call(session, "execution.cancel", {});
      });
      const stopped = (await call(session, "execution.run", {})).state as unknown as CompletedState;
      unsubscribe();
      expect(stopped.execution.status).toBe("cancelled");
      expect(stopped.execution.result.report.checks).toBe("complete");
      if (stopped.execution.result.workspaceRoot)
        await rm(stopped.execution.result.workspaceRoot, { recursive: true, force: true });
      expect(await readFile(join(root, "note.txt"), "utf8")).toBe("dirty");
      expect(await readFile(join(root, "secret.txt"), "utf8")).toBe("private");
    } finally {
      await call(session, "workspace.discover", { root: "relative", exclusions: [] });
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
