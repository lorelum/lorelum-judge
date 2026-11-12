import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prepareReview } from "@lorelum/judge";
import { validateWorkflowRecordChain } from "@lorelum/judge-protocol";
import {
  ControlledExecutionSession,
  closeWorkspaceReview,
  discoverWorkspace,
  PlanningSession,
  verificationIdentity,
} from "@lorelum/judge-workflow";
import { createBubblewrapSandbox } from "@lorelum/runtime-bubblewrap";
import { assert } from "./shared.js";

const exec = promisify(execFile);
const initial = "original committed content\n";
const dirty = "dirty tracked content\n";
const final = "verified candidate content\n";
const untracked = "untracked user content\n";

/** Real Linux sandbox consumer; no remote model, network access, or fake runner. */
export async function runWorkflowExecution() {
  if (process.platform !== "linux")
    return { status: "unsupported", reason: "bubblewrap requires Linux" };
  const root = await mkdtemp(join(await realpath(tmpdir()), "lorelum-consumer-"));
  const git = (...args) =>
    exec("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
  let workspace;
  const executionRoots = [];
  try {
    await git("init", "-q");
    await git("config", "user.name", "Workflow smoke");
    await git("config", "user.email", "workflow-smoke@example.invalid");
    await writeFile(join(root, "app.txt"), initial);
    await git("add", "app.txt");
    await git("commit", "-q", "--no-verify", "-m", "initial");
    await writeFile(join(root, "app.txt"), dirty);
    await writeFile(join(root, "notes.txt"), untracked);
    const originalStatus = (await git("status", "--porcelain=v1", "--untracked-files=all")).stdout;

    const signal = new AbortController().signal;
    workspace = await discoverWorkspace(root, [], signal);
    assert(
      workspace.candidates.some((entry) => entry.path === "app.txt" && entry.origin === "modified"),
      "tracked dirty file must be discovered",
    );
    assert(
      workspace.candidates.some(
        (entry) => entry.path === "notes.txt" && entry.origin === "untracked",
      ),
      "untracked file must be discovered",
    );
    const task = {
      schema: "lorelum.judge.task-contract/v1",
      id: "execution-task",
      taskClass: "code",
      text: "Update app.txt and verify its content",
    };
    const sources = [
      {
        id: "request",
        kind: "user",
        locator: "request:1",
        version: "1",
        content: task.text,
        status: "available",
      },
    ];
    const plan = new PlanningSession("execution-plan", { task, sources });
    const planner = {
      async generate(request) {
        const input = JSON.parse(request.messages[1].content);
        return {
          kind: "structured",
          value: {
            schema: "workflow-plan/v1",
            id: input.id,
            revision: input.revision,
            sources: input.sources,
            task: {
              ...input.task,
              acceptance: [
                {
                  id: "content",
                  text: "Candidate contains verified content",
                  source: { origin: "user", ref: "request" },
                },
              ],
            },
            goal: "Update the candidate content",
            scope: ["app.txt"],
            steps: [
              {
                id: "edit",
                description: input.instructions || "Edit the candidate",
                acceptanceIds: ["content"],
              },
            ],
            checks: [
              {
                id: "verify",
                description: "Read the candidate with cat",
                acceptanceIds: ["content"],
              },
            ],
            nonGoals: ["Publish or write to the source project"],
            missing: [],
            conflicts: [],
          },
        };
      },
    };
    const disclosureIdentity = plan.grantModelDisclosure(planner);
    const first = await plan.generate({
      model: planner,
      runId: "plan-initial",
      signal,
      disclosureIdentity,
    });
    assert(first.ok, "initial plan must be generated");
    const revision = await plan.generate({
      model: planner,
      runId: "plan-adjusted",
      signal,
      disclosureIdentity,
      instructions: "Preserve the user's untracked file",
    });
    assert(
      revision.ok && !plan.isEligible(first.value.identity, first.value.revision),
      "adjustment must invalidate the previous plan",
    );
    const confirmed = plan.confirm(revision.value.identity, revision.value.revision);
    assert(
      confirmed.ok && plan.isEligible(revision.value.identity, revision.value.revision),
      "revised plan must be explicitly confirmed",
    );

    const implementer = {
      async generate(request) {
        const prompt = JSON.parse(request.messages[0].content);
        const observedRead = prompt.observations.find(
          (entry) => entry.type === "read" && entry.path === "app.txt",
        );
        const observedWrite = prompt.observations.find(
          (entry) => entry.type === "write" && entry.path === "app.txt",
        );
        const value = !observedRead
          ? { type: "read", path: "app.txt" }
          : !observedWrite
            ? {
                type: "write",
                path: "app.txt",
                expectedIdentity: observedRead.identity,
                content: final,
              }
            : { type: "done" };
        return { kind: "structured", value };
      },
    };
    const definition = {
      schema: "lorelum.judge.measurement-definition/v2",
      id: "execution-check",
      criteria: [
        {
          schema: "lorelum.judge.criterion/v1",
          id: "content",
          kind: "contract",
          description: "Candidate and independently executed check contain expected content",
          mandatory: true,
          source: { origin: "contract", ref: "content" },
          anchors: [
            { verdict: "met", description: "Both match" },
            { verdict: "unmet", description: "Either differs" },
          ],
          evidence: [
            { evidenceId: "candidate-1", role: "primary" },
            { evidenceId: "check-1", role: "primary" },
          ],
        },
      ],
      metadata: [{ criterionId: "content", role: "decisive", covers: [], appliesTo: ["code"] }],
    };
    let checkerCalled = false;
    const checker = ({ evidence }) => {
      checkerCalled = true;
      const candidate = evidence.find((item) => item.id === "candidate-1");
      const check = evidence.find((item) => item.id === "check-1");
      let met = false;
      if (candidate?.status === "present" && check?.status === "present") {
        const code = JSON.parse(candidate.text);
        const observed = JSON.parse(check.text);
        met =
          code.path === "app.txt" &&
          code.content === final &&
          observed.id === "verify" &&
          observed.status === "passed" &&
          observed.exitCode === 0 &&
          observed.stdout === final &&
          observed.candidateIdentity;
      }
      return {
        verdicts: [
          {
            schema: "lorelum.judge.verdict/v1",
            criterionId: "content",
            verdict: met ? "met" : "unmet",
            evidenceIds: ["candidate-1", "check-1"],
          },
        ],
      };
    };
    const reviewInput = {
      definition,
      method: { kind: "program", checker: { id: "content-checker", version: "1" } },
    };
    // Preparation derives the public definition/instrument identities without executing a review.
    const prepared = prepareReview(
      {
        ...reviewInput,
        evidence: [
          { id: "candidate-1", status: "unavailable" },
          { id: "check-1", status: "unavailable" },
        ],
      },
      { checker },
    );
    assert(prepared.ok, "review configuration must prepare successfully");
    const policy = {
      schema: "lorelum.judge.gate-policy/v2",
      id: "execution-policy",
      definitionIdentity: prepared.value.definitionIdentity,
      instrumentIdentity: prepared.value.instrumentIdentity,
      scopes: [{ taskClass: "code", evidenceShape: "code", criterionIds: ["content"] }],
      criteria: [
        {
          criterionId: "content",
          acceptedVerdicts: ["met"],
          requiredCaseKinds: ["decisive", "equivalent", "anti"],
        },
      ],
      minimumAgreement: 1,
      minimumGroupsPerCaseKind: 1,
      confidenceLevel: 0.95,
      maximumFalseAcceptRate: 0.05,
      maximumFalseRejectRate: 0.1,
      maximumAbstentionRate: 0.2,
      maximumDisagreementRate: 0.2,
      onUncalibrated: "diagnostic",
    };
    const command = { executable: "/usr/bin/cat", args: ["app.txt"], cwd: "." };
    const verification = {
      checks: [
        {
          id: "verify",
          version: null,
          environmentIdentity: null,
          ...command,
          readPaths: ["."],
          timeoutMs: 30000,
          maxOutputBytes: 4096,
        },
      ],
      review: {
        input: reviewInput,
        ports: { checker },
        gate: {
          id: "execution-gate",
          taskClass: "code",
          evidenceShape: "code",
          policy,
          now: new Date().toISOString(),
        },
      },
    };
    const permission = {
      planIdentity: revision.value.identity,
      planRevision: revision.value.revision,
      workspaceIdentity: workspace.identity,
      readPaths: ["app.txt"],
      commandReadPaths: ["."],
      writePaths: ["app.txt"],
      writablePaths: [],
      commands: [command],
      disclosures: ["plan", "file-content", "command-output", "review"],
      modelRecipient: "offline-implementer",
      limits: {
        totalTimeMs: 120000,
        commandTimeMs: 30000,
        modelCalls: 8,
        actions: 8,
        commands: 2,
        outputBytes: 65536,
      },
      expiresAt: Date.now() + 180000,
      isolation: "bubblewrap-no-network",
      verificationIdentity: verificationIdentity(verification),
    };
    async function assertOriginalUnchanged() {
      assert(
        (await readFile(join(root, "app.txt"), "utf8")) === dirty,
        "negative case changed tracked source",
      );
      assert(
        (await readFile(join(root, "notes.txt"), "utf8")) === untracked,
        "negative case changed untracked source",
      );
      assert(
        (await git("status", "--porcelain=v1", "--untracked-files=all")).stdout === originalStatus,
        "negative case changed source Git state",
      );
    }
    async function expectRefusal(operation, expectedMessage, description) {
      let reason = "";
      try {
        await operation();
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
      assert(reason.includes(expectedMessage), `${description}: ${reason}`);
    }
    async function blockedCase(casePlan, casePermission, proposalMustFail, authorize) {
      const caseWorkspace = await discoverWorkspace(root, [], signal);
      const session = new ControlledExecutionSession(casePlan, caseWorkspace);
      const actualSandbox = createBubblewrapSandbox();
      let sandboxCalls = 0;
      const observingSandbox = {
        async run(request) {
          sandboxCalls++;
          return actualSandbox.run(request);
        },
      };
      try {
        if (proposalMustFail) {
          await expectRefusal(
            () => session.propose(casePermission, verification),
            "Plan or workspace is not current",
            "ineligible plan must refuse an execution proposal",
          );
        } else {
          const proposal = session.propose(casePermission, verification);
          if (authorize)
            session.authorize(
              proposal.identity,
              implementer,
              "consumer-negative-user-decision",
              checker,
            );
        }
        if (!authorize) {
          await expectRefusal(
            () =>
              session.implement({
                model: implementer,
                sandbox: observingSandbox,
                runId: "blocked",
                signal,
              }),
            "Independent permission and matching disclosure recipient required",
            "execution without an eligible, authorized proposal must be refused",
          );
        } else {
          const outcome = await session.implement({
            model: implementer,
            sandbox: observingSandbox,
            runId: "insufficient-permission",
            signal,
          });
          if (outcome.workspaceRoot) executionRoots.push(outcome.workspaceRoot);
          assert(
            outcome.status === "failed" &&
              outcome.reason.includes("Read or disclosure not authorized"),
            "unapproved file access must fail before sandbox execution",
          );
        }
        assert(sandboxCalls === 0, "blocked execution must not start the sandbox");
        await assertOriginalUnchanged();
      } finally {
        session.revoke();
        await closeWorkspaceReview(caseWorkspace);
      }
    }
    const unconfirmed = new PlanningSession("unconfirmed-plan", { task, sources });
    const unconfirmedDisclosure = unconfirmed.grantModelDisclosure(planner);
    const draft = await unconfirmed.generate({
      model: planner,
      runId: "unconfirmed",
      signal,
      disclosureIdentity: unconfirmedDisclosure,
    });
    assert(draft.ok && !draft.value.eligible, "draft must remain unconfirmed");
    await blockedCase(
      unconfirmed,
      { ...permission, planIdentity: draft.value.identity, planRevision: draft.value.revision },
      true,
      false,
    );
    await blockedCase(plan, permission, false, false);
    await blockedCase(
      plan,
      { ...permission, planIdentity: first.value.identity, planRevision: first.value.revision },
      true,
      false,
    );
    const conflicting = new PlanningSession("conflicting-plan", { task, sources });
    const conflictingPlanner = {
      async generate(request) {
        const response = await planner.generate(request);
        response.value.conflicts = [
          { description: "The user must resolve conflicting requirements", sourceIds: ["request"] },
        ];
        return response;
      },
    };
    const conflictDisclosure = conflicting.grantModelDisclosure(conflictingPlanner);
    const conflict = await conflicting.generate({
      model: conflictingPlanner,
      runId: "conflict",
      signal,
      disclosureIdentity: conflictDisclosure,
    });
    assert(
      conflict.ok && conflict.value.plan.conflicts.length === 1,
      "unresolved conflict must remain visible",
    );
    assert(
      !conflicting.confirm(conflict.value.identity, conflict.value.revision).ok,
      "conflicted plan cannot be confirmed",
    );
    await blockedCase(
      conflicting,
      {
        ...permission,
        planIdentity: conflict.value.identity,
        planRevision: conflict.value.revision,
      },
      true,
      false,
    );
    await blockedCase(plan, { ...permission, readPaths: [] }, false, true);
    async function executeCase(configuration, approvedPermission, cancelAfterCheck = false) {
      const caseWorkspace = await discoverWorkspace(root, [], signal);
      const session = new ControlledExecutionSession(plan, caseWorkspace);
      const proposal = session.propose(approvedPermission, configuration);
      session.authorize(proposal.identity, implementer, "consumer-explicit-user-decision", checker);
      const controller = new AbortController();
      const actualSandbox = createBubblewrapSandbox();
      let runnerRoot;
      const observingSandbox = {
        async run(request) {
          runnerRoot = request.root;
          const outcome = await actualSandbox.run(request);
          if (cancelAfterCheck) controller.abort();
          return outcome;
        },
      };
      const outcome = await session.implement({
        model: implementer,
        sandbox: observingSandbox,
        runId: "implementation",
        signal: controller.signal,
      });
      await closeWorkspaceReview(caseWorkspace);
      if (outcome.workspaceRoot) executionRoots.push(outcome.workspaceRoot);
      assert(
        runnerRoot && outcome.workspaceRoot && runnerRoot !== outcome.workspaceRoot,
        "checks must use an independent runner copy",
      );
      let runnerRemoved = false;
      try {
        await lstat(runnerRoot);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        runnerRemoved = true;
      }
      assert(runnerRemoved, "independent runner must be cleaned up after execution");
      assert(
        (await readFile(join(outcome.workspaceRoot, "app.txt"), "utf8")) === final,
        "candidate copy must remain available for review",
      );
      return outcome;
    }
    const result = await executeCase(verification, permission);
    assert(result.status === "completed", `controlled execution failed: ${result.reason}`);
    assert(
      result.evidence?.checks.length === 1 && result.evidence.checks[0].status === "passed",
      "independent sandbox check must pass",
    );
    assert(
      result.evidence.checks[0].stdout === final,
      "independent check must observe candidate bytes",
    );
    assert(
      checkerCalled &&
        result.evidence.review?.ok &&
        result.evidence.review.value.completeness === "complete",
      "real public judge must assess actual evidence",
    );
    assert(
      result.evidence.gate?.ok && result.evidence.gate.value.decision.qualityOutcome === "pass",
      "real public gate must report observed quality",
    );
    assert(
      result.evidence.gate.value.enforcementEligibility === false &&
        result.evidence.gate.value.reasons.includes("calibration_unavailable"),
      "uncalibrated gate must remain advisory",
    );
    assert(
      result.report?.diff.includes("verified candidate content"),
      "report must include the real candidate diff",
    );
    assert(
      result.records && validateWorkflowRecordChain(result.records).ok,
      "protocol record chain must validate",
    );
    assert(
      result.records.evidence.candidateIdentity === result.evidence.candidateIdentity,
      "report evidence must identify the tested candidate",
    );
    assert(
      result.records.report.candidateIdentity === result.evidence.candidateIdentity &&
        result.records.report.quality === "passed" &&
        result.records.report.enforcement === "ineligible",
      "protocol report must preserve candidate identity and independent outcomes",
    );
    const failingCommand = { ...command, args: ["missing.txt"] };
    const failingVerification = {
      ...verification,
      checks: [{ ...verification.checks[0], ...failingCommand }],
    };
    const failingPermission = {
      ...permission,
      commands: [failingCommand],
      verificationIdentity: verificationIdentity(failingVerification),
    };
    const failed = await executeCase(failingVerification, failingPermission);
    assert(
      failed.evidence?.checks[0]?.status === "failed",
      "real nonzero check must remain a failure",
    );
    assert(
      failed.evidence.enforcement === "ineligible",
      "failed check must not be eligible for enforcement",
    );
    const cancelled = await executeCase(verification, permission, true);
    assert(
      cancelled.status === "cancelled",
      "cancellation after the real sandbox check must be recorded",
    );
    assert(
      (await readFile(join(root, "app.txt"), "utf8")) === dirty,
      "source tracked file must remain untouched",
    );
    assert(
      (await readFile(join(root, "notes.txt"), "utf8")) === untracked,
      "source untracked file must remain untouched",
    );
    assert(
      (await git("status", "--porcelain=v1", "--untracked-files=all")).stdout === originalStatus,
      "source Git status must remain unchanged",
    );
    return {
      status: "completed",
      check: result.evidence.checks[0].status,
      quality: result.evidence.gate.value.decision.qualityOutcome,
      enforcementEligibility: result.evidence.gate.value.enforcementEligibility,
    };
  } finally {
    if (workspace) await closeWorkspaceReview(workspace);
    for (const executionRoot of executionRoots)
      await rm(executionRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}
