import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue, ModelPort, SandboxPort } from "@lorelum/judge-runtime";
import {
  ControlledExecutionSession,
  discoverWorkspace,
  PlanningSession,
  type VerificationConfiguration,
  verificationIdentity,
} from "../src/index.js";

const linux = process.platform === "linux" ? describe : describe.skip;
linux("controlled execution", () => {
  test("dirty and untracked files are reviewed and edits stay in a private copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-project-"));
    let copy: string | null = null;
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
      git("init");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "Test");
      await writeFile(join(root, "file.txt"), "base");
      git("add", "file.txt");
      git("commit", "-m", "initial");
      await writeFile(join(root, "file.txt"), "dirty");
      await writeFile(join(root, "secret.txt"), "secret");
      const workspace = await discoverWorkspace(root, [
        { path: "secret.txt", reason: "sensitive" },
      ]);
      expect(workspace.candidates.find((item) => item.path === "file.txt")?.origin).toBe(
        "modified",
      );
      expect(workspace.candidates.find((item) => item.path === "secret.txt")?.status).toBe(
        "excluded",
      );
      const task = {
        schema: "lorelum.judge.task-contract/v1" as const,
        id: "task",
        taskClass: "test",
        text: "Edit file",
        acceptance: [{ id: "a", text: "Edit", source: { origin: "user" as const, ref: "s" } }],
      };
      const sources = [
        {
          id: "s",
          kind: "user" as const,
          locator: "request",
          version: "1",
          content: "Edit",
          status: "available" as const,
        },
      ];
      const plan = new PlanningSession("plan", { task, sources });
      const planningModel: ModelPort = {
        async generate() {
          return {
            kind: "structured",
            value: {
              schema: "workflow-plan/v1",
              id: "plan",
              revision: 1,
              task,
              sources,
              goal: "Edit",
              scope: ["file"],
              steps: [{ id: "step", description: "Edit", acceptanceIds: ["a"] }],
              checks: [{ id: "check", description: "Inspect", acceptanceIds: ["a"] }],
              nonGoals: ["delivery"],
              missing: [],
              conflicts: [],
            } as unknown as JsonValue,
          };
        },
      };
      const proposal = await plan.generate({
        model: planningModel,
        runId: "plan",
        signal: new AbortController().signal,
        disclosureIdentity: plan.grantModelDisclosure(planningModel),
      });
      if (!proposal.ok) throw new Error("planning failed");
      plan.confirm(proposal.value.identity, proposal.value.revision);
      const session = new ControlledExecutionSession(plan, workspace);
      const permission = session.propose({
        planIdentity: proposal.value.identity,
        planRevision: proposal.value.revision,
        workspaceIdentity: workspace.identity,
        readPaths: ["file.txt"],
        commandReadPaths: [],
        writePaths: ["file.txt"],
        writablePaths: [],
        commands: [],
        disclosures: ["plan", "file-content"],
        modelRecipient: "test-model",
        limits: {
          totalTimeMs: 30000,
          commandTimeMs: 1000,
          modelCalls: 3,
          actions: 3,
          commands: 1,
          outputBytes: 10000,
        },
        expiresAt: Date.now() + 30000,
        isolation: "bubblewrap-no-network",
      });
      let sandboxRuns = 0;
      const sandbox: SandboxPort = {
        async run() {
          sandboxRuns++;
          throw new Error("unexpected sandbox call");
        },
      };
      const unauthorizedCommand = {
        executable: "/bin/true",
        args: [],
        cwd: ".",
        root: "/",
        writablePaths: ["etc"],
      };
      const maliciousSession = new ControlledExecutionSession(plan, workspace);
      expect(() =>
        maliciousSession.propose({
          ...permission.permission,
          commands: [unauthorizedCommand],
        }),
      ).toThrow("unknown fields");
      expect(sandboxRuns).toBe(0);
      expect(await readFile(join(root, "file.txt"), "utf8")).toBe("dirty");
      let calls = 0;
      const implementer: ModelPort = {
        async generate() {
          calls++;
          return {
            kind: "structured",
            value:
              calls === 1
                ? {
                    type: "write",
                    path: "file.txt",
                    expectedIdentity: `sha256:${createHash("sha256").update("dirty").digest("hex")}`,
                    content: "changed",
                  }
                : { type: "done" },
          };
        },
      };
      const checker = () => ({ verdicts: [] });
      const configuration: VerificationConfiguration = {
        checks: [],
        review: {
          input: { definition: {}, method: { kind: "program", checker: { id: "host-checker" } } },
          ports: { checker },
        },
      };
      const checkerSession = new ControlledExecutionSession(plan, workspace);
      const checkerPermission = checkerSession.propose(
        { ...permission.permission, verificationIdentity: verificationIdentity(configuration) },
        configuration,
      );
      expect(() =>
        checkerSession.authorize(checkerPermission.identity, implementer, "decision"),
      ).toThrow();
      expect(() =>
        checkerSession.authorize(checkerPermission.identity, implementer, "decision", () => ({
          verdicts: [],
        })),
      ).toThrow();
      expect(() =>
        checkerSession.authorize(checkerPermission.identity, implementer, "decision", checker),
      ).not.toThrow();
      checkerSession.revoke();
      session.authorize(permission.identity, implementer, "user-decision-1");
      const result = await session.implement({
        model: implementer,
        sandbox,
        runId: "run",
        signal: new AbortController().signal,
      });
      copy = result.workspaceRoot;
      expect(result.status).toBe("failed");
      expect(result.records).toBeDefined();
      expect(await readFile(join(root, "file.txt"), "utf8")).toBe("dirty");
      expect(copy).not.toBeNull();
      expect(await readFile(join(copy!, "file.txt"), "utf8")).toBe("changed");
      expect(calls).toBe(2);
      expect(result.reason).toContain("verification");
      expect(
        workspace.candidates.find((item) => item.path === "secret.txt")?.contentIdentity,
      ).toBeNull();
    } finally {
      if (copy) await rm(copy, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("workspace discovery rejects unsupported platforms", async () => {
  if (process.platform === "linux") return;
  const root = await mkdtemp(join(tmpdir(), "workflow-unsupported-"));
  try {
    await expect(discoverWorkspace(root, [])).rejects.toThrow("requires Linux");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
