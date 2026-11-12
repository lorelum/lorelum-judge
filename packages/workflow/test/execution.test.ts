import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    let cancelledCopy: string | null = null;
    let modeCopy: string | null = null;
    let limitedCopy: string | null = null;
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
      git("init");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "Test");
      await writeFile(join(root, "file.txt"), "base");
      await chmod(join(root, "file.txt"), 0o644);
      await mkdir(join(root, "work"));
      await writeFile(join(root, "work", "script.txt"), "script");
      await chmod(join(root, "work", "script.txt"), 0o644);
      git("add", "file.txt", "work/script.txt");
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
      const failureReport = result.report as { diff: string; unknowns: string[] };
      expect(failureReport.diff).toContain("-dirty");
      expect(failureReport.diff).toContain("+changed");
      expect(failureReport.unknowns).not.toContain("diff unavailable");

      const nextWorkspace = await discoverWorkspace(root, [
        { path: "secret.txt", reason: "sensitive" },
      ]);
      const controller = new AbortController();
      const doneModel: ModelPort = {
        async generate() {
          return { kind: "structured", value: { type: "done" } };
        },
      };
      const checkConfiguration: VerificationConfiguration = {
        checks: [
          {
            id: "check",
            version: null,
            environmentIdentity: null,
            executable: "/bin/true",
            args: [],
            cwd: ".",
            readPaths: ["."],
            timeoutMs: 1000,
            maxOutputBytes: 1000,
          },
        ],
        review: {
          input: { definition: {}, method: { kind: "program", checker: { id: "host-checker" } } },
          ports: { checker },
        },
      };
      const cancelledSession = new ControlledExecutionSession(plan, nextWorkspace);
      const cancelledPermission = cancelledSession.propose(
        {
          ...permission.permission,
          workspaceIdentity: nextWorkspace.identity,
          commandReadPaths: ["."],
          commands: [{ executable: "/bin/true", args: [], cwd: "." }],
          disclosures: ["plan", "file-content", "command-output", "review"],
          verificationIdentity: verificationIdentity(checkConfiguration),
        },
        checkConfiguration,
      );
      cancelledSession.authorize(
        cancelledPermission.identity,
        doneModel,
        "decision-cancelled",
        checker,
      );
      const cancelled = await cancelledSession.implement({
        model: doneModel,
        runId: "cancel-after-check",
        signal: controller.signal,
        sandbox: {
          async run() {
            controller.abort();
            return {
              status: "completed",
              exitCode: 1,
              stdout: "known failure",
              stderr: "failure output",
            };
          },
        },
      });
      cancelledCopy = cancelled.workspaceRoot;
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.evidence?.checks[0]?.status).toBe("failed");
      expect(cancelled.evidence?.checks[0]?.exitCode).toBe(1);
      expect(cancelled.evidence?.checks[0]?.stdout).toBe("known failure");
      expect(cancelled.evidence?.review).toBeNull();
      const cancelledReport = cancelled.report as {
        checks: string;
        quality: string;
        unknowns: string[];
      };
      expect(cancelledReport.quality).toBe("unknown");
      expect(cancelledReport.unknowns).toContain("review unavailable");
      const modeWorkspace = await discoverWorkspace(root, [
        { path: "secret.txt", reason: "sensitive" },
      ]);
      const modeSession = new ControlledExecutionSession(plan, modeWorkspace);
      const modePermission = modeSession.propose({
        ...permission.permission,
        workspaceIdentity: modeWorkspace.identity,
        commandReadPaths: ["."],
        writablePaths: ["work"],
        commands: [{ executable: "/bin/chmod", args: ["+x", "work/script.txt"], cwd: "." }],
        disclosures: ["plan", "command-output"],
      });
      let modeCalls = 0;
      const modeModel: ModelPort = {
        async generate() {
          modeCalls++;
          return {
            kind: "structured",
            value: modeCalls === 1 ? { type: "command", index: 0 } : { type: "done" },
          };
        },
      };
      modeSession.authorize(modePermission.identity, modeModel, "decision-mode");
      const modeResult = await modeSession.implement({
        model: modeModel,
        runId: "mode-only",
        signal: new AbortController().signal,
        sandbox: {
          async run(request) {
            await chmod(join(request.root, "work", "script.txt"), 0o755);
            return { status: "completed", exitCode: 0, stdout: "", stderr: "" };
          },
        },
      });
      modeCopy = modeResult.workspaceRoot;
      const modeReport = modeResult.report as { diff: string };
      expect(modeReport.diff).toContain("old mode 644");
      expect(modeReport.diff).toContain("new mode 755");
      const limitedWorkspace = await discoverWorkspace(root, [
        { path: "secret.txt", reason: "sensitive" },
      ]);
      const limitedSession = new ControlledExecutionSession(plan, limitedWorkspace);
      const limitedPermission = limitedSession.propose({
        ...modePermission.permission,
        workspaceIdentity: limitedWorkspace.identity,
      });
      let limitedCalls = 0;
      const limitedModel: ModelPort = {
        async generate() {
          limitedCalls++;
          return {
            kind: "structured",
            value: limitedCalls === 1 ? { type: "command", index: 0 } : { type: "done" },
          };
        },
      };
      limitedSession.authorize(limitedPermission.identity, limitedModel, "decision-large");
      const limitedResult = await limitedSession.implement({
        model: limitedModel,
        runId: "diagnostic-limit",
        signal: new AbortController().signal,
        sandbox: {
          async run(request) {
            await writeFile(
              join(request.root, "work", "large.bin"),
              Buffer.alloc(4 * 1024 * 1024 + 1),
            );
            return { status: "completed", exitCode: 0, stdout: "", stderr: "" };
          },
        },
      });
      limitedCopy = limitedResult.workspaceRoot;
      const limitedReport = limitedResult.report as { diff: string; unknowns: string[] };
      expect(limitedReport.diff).toBe("");
      expect(
        limitedReport.unknowns.some(
          (item) => item.includes("diff unavailable") && item.includes("limit"),
        ),
      ).toBe(true);
      expect(limitedCalls).toBe(2);
      expect(
        workspace.candidates.find((item) => item.path === "secret.txt")?.contentIdentity,
      ).toBeNull();
    } finally {
      if (limitedCopy) await rm(limitedCopy, { recursive: true, force: true });
      if (modeCopy) await rm(modeCopy, { recursive: true, force: true });
      if (cancelledCopy) await rm(cancelledCopy, { recursive: true, force: true });
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
