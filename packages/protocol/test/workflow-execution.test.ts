import { describe, expect, test } from "bun:test";
import {
  identityOf,
  validateWorkflowAuthorization,
  validateWorkflowEvidence,
  validateWorkflowRecordChain,
  validateWorkflowReport,
  validateWorkflowWorkspace,
  workflowAuthorizationIdentity,
  workflowEvidenceIdentity,
  workflowExecutionIdentity,
  workflowPlanIdentity,
  workflowWorkspaceIdentity,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const plan = {
  schema: "workflow-plan/v1",
  id: "p",
  revision: 1,
  sources: [
    {
      id: "s",
      kind: "user",
      locator: "request:1",
      version: "1",
      content: "Build",
      status: "available",
    },
  ],
  task: {
    schema: "lorelum.judge.task-contract/v1",
    id: "t",
    taskClass: "code",
    text: "Build",
    acceptance: [{ id: "a", text: "Works", source: { origin: "user", ref: "s" } }],
  },
  goal: "Build",
  scope: ["src"],
  steps: [{ id: "step", description: "Build", acceptanceIds: ["a"] }],
  checks: [{ id: "check", description: "Check", acceptanceIds: ["a"] }],
  nonGoals: [],
  missing: [],
  conflicts: [],
};
const limits = {
  totalTimeMs: 1000,
  commandTimeMs: 100,
  modelCalls: 1,
  actions: 2,
  commands: 1,
  outputBytes: 100,
};
function id(outcome: { ok: true; identity: string } | { ok: false }): string {
  if (!outcome.ok) throw new Error("invalid test record");
  return outcome.identity;
}
function records() {
  const workspace = {
    schema: "workflow-workspace/v1",
    sourceIdentity: hash,
    gitIdentity: hash,
    rootIdentity: { dev: "1", ino: "2" },
    files: [
      {
        path: "src/a",
        source: "modified",
        excluded: false,
        exclusionReason: null,
        status: "present",
        contentIdentity: hash,
        mode: 420,
      },
    ],
  };
  const check = {
    id: "check",
    executable: "/bin/check",
    args: [],
    cwd: ".",
    version: "1",
    environmentIdentity: hash,
    timeoutMs: 100,
    maxOutputBytes: 100,
    readPaths: ["."],
  };
  const verification = {
    schema: "workflow-verification/v1",
    checks: [check],
    reviewConfigurationIdentity: hash,
  };
  const authorization = {
    schema: "workflow-authorization/v1",
    planIdentity: id(workflowPlanIdentity(plan)),
    planRevision: 1,
    workspaceIdentity: id(workflowWorkspaceIdentity(workspace)),
    readPaths: ["src"],
    writePaths: ["src"],
    writablePaths: ["src"],
    commandReadPaths: ["."],
    commands: [{ executable: "/bin/check", args: [], cwd: "." }],
    disclosures: ["model"],
    modelRecipient: "model:1",
    expiresAt: null,
    verification,
    verificationIdentity: id(identityOf(verification.schema, verification)),
    isolation: "linux-bwrap",
    limits,
    decision: "approved",
    decisionRef: "host:1",
  };
  const execution = {
    schema: "workflow-execution/v1",
    planIdentity: authorization.planIdentity,
    planRevision: 1,
    workspaceIdentity: authorization.workspaceIdentity,
    authorizationIdentity: id(workflowAuthorizationIdentity(authorization)),
    status: "completed",
    stopReason: "done",
    usage: limits,
  };
  const evidence = {
    schema: "workflow-evidence/v1",
    executionIdentity: id(workflowExecutionIdentity(execution)),
    candidateIdentity: hash,
    checks: [{ ...check, status: "passed", exitCode: 0, stdout: "", stderr: "" }],
  };
  const report = {
    schema: "workflow-report/v1",
    executionIdentity: evidence.executionIdentity,
    evidenceIdentity: id(workflowEvidenceIdentity(evidence)),
    planIdentity: authorization.planIdentity,
    candidateIdentity: hash,
    reviewIdentity: hash,
    gateIdentity: hash,
    diff: "",
    quality: "passed",
    checks: "complete",
    enforcement: "eligible",
    unknowns: [],
  };
  return { plan, workspace, authorization, execution, evidence, report };
}

describe("workflow execution records", () => {
  test("validates linked records and detects changed identities and revisions", () => {
    const r = records();
    expect(validateWorkflowRecordChain(r).ok).toBe(true);
    expect(validateWorkflowRecordChain({ ...r, plan: { ...plan, revision: 2 } }).ok).toBe(false);
    expect(
      validateWorkflowRecordChain({
        ...r,
        report: { ...r.report, candidateIdentity: `sha256:${"b".repeat(64)}` },
      }).ok,
    ).toBe(false);
    expect(
      workflowAuthorizationIdentity({ ...r.authorization, writePaths: ["other"] }),
    ).not.toEqual(workflowAuthorizationIdentity(r.authorization));
    for (const change of [
      { writablePaths: ["other"] },
      { commandReadPaths: [".", "src"] },
      { modelRecipient: "model:2" },
      { expiresAt: "2030-01-01T00:00:00.000Z" },
    ]) {
      const changed = workflowAuthorizationIdentity({ ...r.authorization, ...change });
      expect(changed.ok).toBe(true);
      expect(changed).not.toEqual(workflowAuthorizationIdentity(r.authorization));
    }
    expect(
      workflowWorkspaceIdentity({
        ...r.workspace,
        files: [{ ...r.workspace.files[0], source: "committed" }],
      }),
    ).not.toEqual(workflowWorkspaceIdentity(r.workspace));
    for (const change of [
      { sourceIdentity: `sha256:${"b".repeat(64)}` },
      { gitIdentity: `sha256:${"b".repeat(64)}` },
      { rootIdentity: { dev: "1", ino: "3" } },
    ]) {
      expect(workflowWorkspaceIdentity({ ...r.workspace, ...change })).not.toEqual(
        workflowWorkspaceIdentity(r.workspace),
      );
      expect(
        validateWorkflowRecordChain({ ...r, workspace: { ...r.workspace, ...change } }).ok,
      ).toBe(false);
    }
    expect(
      validateWorkflowWorkspace({ ...r.workspace, rootIdentity: { dev: "1", ino: "not-an-inode" } })
        .ok,
    ).toBe(false);
    expect(
      validateWorkflowAuthorization({
        ...r.authorization,
        verification: {
          ...r.authorization.verification,
          reviewConfigurationIdentity: `sha256:${"b".repeat(64)}`,
        },
      }).ok,
    ).toBe(false);
    expect(validateWorkflowAuthorization({ ...r.authorization, modelRecipient: null }).ok).toBe(
      false,
    );
    expect(validateWorkflowAuthorization({ ...r.authorization, expiresAt: "not-a-date" }).ok).toBe(
      false,
    );
    const changedEvidence = { ...r.evidence, checks: [{ ...r.evidence.checks[0], timeoutMs: 1 }] };
    expect(
      validateWorkflowRecordChain({
        ...r,
        evidence: changedEvidence,
        report: { ...r.report, evidenceIdentity: id(workflowEvidenceIdentity(changedEvidence)) },
      }).ok,
    ).toBe(false);
    const excluded = {
      path: ".env",
      source: "unknown",
      excluded: true,
      exclusionReason: "sensitive",
      status: "unknown",
      contentIdentity: null,
      mode: null,
    };
    expect(validateWorkflowWorkspace({ ...r.workspace, files: [excluded] }).ok).toBe(true);
    expect(
      validateWorkflowWorkspace({ ...r.workspace, files: [{ ...excluded, contentIdentity: hash }] })
        .ok,
    ).toBe(false);
  });
  test("rejects traversal, duplicate files, inconsistent deletion and malformed identities", () => {
    const r = records();
    expect(
      validateWorkflowWorkspace({
        ...r.workspace,
        files: [{ ...r.workspace.files[0], path: "../secret" }],
      }).ok,
    ).toBe(false);
    expect(
      validateWorkflowWorkspace({
        ...r.workspace,
        files: [r.workspace.files[0], r.workspace.files[0]],
      }).ok,
    ).toBe(false);
    expect(
      validateWorkflowWorkspace({
        ...r.workspace,
        files: [{ ...r.workspace.files[0], status: "deleted" }],
      }).ok,
    ).toBe(false);
    expect(validateWorkflowAuthorization({ ...r.authorization, planIdentity: "invalid" }).ok).toBe(
      false,
    );
    expect(
      validateWorkflowAuthorization({
        ...r.authorization,
        commands: [{ executable: "x", args: [], cwd: "../outside" }],
      }).ok,
    ).toBe(false);
    expect(
      validateWorkflowAuthorization({ ...r.authorization, limits: { ...limits, readBytes: 100 } })
        .ok,
    ).toBe(false);
    expect(
      validateWorkflowAuthorization({ ...r.authorization, limits: { ...limits, inputBytes: 100 } })
        .ok,
    ).toBe(false);
    expect(
      validateWorkflowAuthorization({ ...r.authorization, limits: { ...limits, writeBytes: 100 } })
        .ok,
    ).toBe(false);
  });
  test("keeps failures and unavailable evidence distinct from completion", () => {
    const r = records();
    expect(
      validateWorkflowEvidence({
        ...r.evidence,
        checks: [{ ...r.evidence.checks[0], exitCode: 1 }],
      }).ok,
    ).toBe(false);
    expect(validateWorkflowReport({ ...r.report, checks: "incomplete" }).ok).toBe(false);
    const evidence = {
      ...r.evidence,
      checks: [{ ...r.evidence.checks[0], status: "unavailable", exitCode: null }],
    };
    const report = {
      ...r.report,
      evidenceIdentity: id(workflowEvidenceIdentity(evidence)),
      quality: "unknown",
      checks: "incomplete",
      enforcement: "unknown",
      unknowns: ["check unavailable"],
    };
    expect(validateWorkflowRecordChain({ ...r, evidence, report }).ok).toBe(true);
    expect(
      validateWorkflowRecordChain({ ...r, evidence, report: { ...report, checks: "complete" } }).ok,
    ).toBe(false);
  });
  test("retains a pre-candidate stop and not-started checks without granting eligibility", () => {
    const r = records();
    const evidence = {
      ...r.evidence,
      candidateIdentity: null,
      checks: [{ ...r.evidence.checks[0], status: "not_started", exitCode: null }],
    };
    const report = {
      ...r.report,
      candidateIdentity: null,
      evidenceIdentity: id(workflowEvidenceIdentity(evidence)),
      quality: "unknown",
      checks: "incomplete",
      enforcement: "unknown",
      unknowns: ["candidate not created"],
    };
    expect(validateWorkflowRecordChain({ ...r, evidence, report }).ok).toBe(true);
    expect(
      validateWorkflowReport({
        ...report,
        quality: "passed",
        checks: "complete",
        enforcement: "eligible",
        unknowns: [],
      }).ok,
    ).toBe(false);
    expect(
      validateWorkflowRecordChain({
        ...r,
        evidence,
        report: { ...report, candidateIdentity: hash },
      }).ok,
    ).toBe(false);
    expect(
      validateWorkflowEvidence({
        ...evidence,
        checks: [{ ...evidence.checks[0], stdout: "output" }],
      }).ok,
    ).toBe(false);
  });
});
