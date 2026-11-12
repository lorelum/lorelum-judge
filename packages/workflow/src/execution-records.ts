import type { WorkflowPlan } from "@lorelum/judge-protocol";
import {
  identityOf,
  validateWorkflowRecordChain,
  workflowAuthorizationIdentity,
  workflowEvidenceIdentity,
  workflowExecutionIdentity,
  workflowWorkspaceIdentity,
} from "@lorelum/judge-protocol";
import type { EvidenceReviewResult } from "./evidence-review.js";
import type {
  ExecutionPermission,
  ExecutionUsage,
  VerificationConfiguration,
} from "./execution.js";
import type { WorkspaceCandidateReview } from "./workspace.js";
export interface ApprovedVerificationRecord {
  readonly schema: "workflow-verification/v1";
  readonly checks: VerificationConfiguration["checks"];
  readonly reviewConfigurationIdentity: string;
}

/** Capture the approved serializable facts while calibration is still current. */
export function captureVerificationRecord(
  input: VerificationConfiguration,
): ApprovedVerificationRecord {
  const result = identityOf("workflow-review-configuration/v1", {
    input: input.review.input,
    ...(input.review.gate === undefined ? {} : { gate: input.review.gate }),
  });
  if (!result.ok) throw new Error("Cannot identify review configuration");
  return {
    schema: "workflow-verification/v1",
    checks: structuredClone(input.checks),
    reviewConfigurationIdentity: result.identity,
  };
}

/** Produce protocol records only from actual host decisions and collected evidence. */
export function createExecutionRecords(input: {
  readonly plan: WorkflowPlan;
  readonly workspace: WorkspaceCandidateReview;
  readonly permission: ExecutionPermission;
  readonly decisionRef: string;
  readonly verification?: VerificationConfiguration;
  readonly verificationRecord?: ApprovedVerificationRecord;
  readonly evidence?: EvidenceReviewResult;
  readonly status: "completed" | "failed" | "cancelled" | "timed_out";
  readonly stopReason: string;
  readonly usage: ExecutionUsage;
  readonly diff: string;
  readonly reviewIdentity: string | null;
  readonly gateIdentity: string | null;
  readonly quality: "pass" | "fail" | "unknown";
  readonly unknowns: readonly string[];
}) {
  const workspace = {
    schema: "workflow-workspace/v1",
    sourceIdentity: input.workspace.identity,
    gitIdentity: input.workspace.gitIdentity,
    rootIdentity: input.workspace.rootIdentity,
    files: input.workspace.candidates.map((item) => ({
      path: item.path,
      source: item.origin,
      excluded: item.status === "excluded",
      exclusionReason: item.exclusionReason,
      status: item.status === "excluded" ? "unknown" : item.status,
      contentIdentity: item.contentIdentity,
      mode: item.mode,
    })),
  };
  const workspaceId = workflowWorkspaceIdentity(workspace);
  if (!workspaceId.ok)
    throw new Error(`Invalid workspace record: ${JSON.stringify(workspaceId.issues)}`);
  const verification = input.verificationRecord ?? null;
  const verificationId = verification ? identityOf("workflow-verification/v1", verification) : null;
  if (verificationId && !verificationId.ok)
    throw new Error("Cannot identify verification configuration");
  const authorization = {
    schema: "workflow-authorization/v1",
    planIdentity: input.permission.planIdentity,
    planRevision: input.permission.planRevision,
    workspaceIdentity: workspaceId.identity,
    readPaths: input.permission.readPaths,
    writePaths: input.permission.writePaths,
    writablePaths: input.permission.writablePaths,
    commandReadPaths: input.permission.commandReadPaths,
    commands: input.permission.commands,
    disclosures: input.permission.disclosures,
    modelRecipient: input.permission.modelRecipient,
    expiresAt: new Date(input.permission.expiresAt).toISOString(),
    verification,
    verificationIdentity: verificationId?.ok ? verificationId.identity : null,
    isolation: input.permission.isolation,
    limits: input.permission.limits,
    decision: "approved",
    decisionRef: input.decisionRef,
  };
  const authorizationId = workflowAuthorizationIdentity(authorization);
  if (!authorizationId.ok)
    throw new Error(`Invalid authorization record: ${JSON.stringify(authorizationId.issues)}`);
  const execution = {
    schema: "workflow-execution/v1",
    planIdentity: input.permission.planIdentity,
    planRevision: input.permission.planRevision,
    workspaceIdentity: workspaceId.identity,
    authorizationIdentity: authorizationId.identity,
    status: input.status,
    stopReason: input.stopReason,
    usage: input.usage,
  };
  const executionId = workflowExecutionIdentity(execution);
  if (!executionId.ok)
    throw new Error(`Invalid execution record: ${JSON.stringify(executionId.issues)}`);
  const evidence = {
    schema: "workflow-evidence/v1",
    executionIdentity: executionId.identity,
    candidateIdentity: input.evidence?.candidateIdentity ?? null,
    checks: input.evidence
      ? input.evidence.checks.map((check) => ({
          id: check.id,
          executable: check.executable,
          args: check.args,
          cwd: check.cwd,
          readPaths: check.readPaths,
          timeoutMs: check.timeoutMs,
          maxOutputBytes: check.maxOutputBytes,
          version: check.version,
          environmentIdentity: check.environmentIdentity,
          status: check.status,
          exitCode: check.exitCode,
          stdout: check.stdout,
          stderr: check.stderr,
        }))
      : (input.verification?.checks ?? []).map((check) => ({
          ...check,
          status: "not_started",
          exitCode: null,
          stdout: "",
          stderr: "",
        })),
  };
  const evidenceId = workflowEvidenceIdentity(evidence);
  if (!evidenceId.ok)
    throw new Error(`Invalid evidence record: ${JSON.stringify(evidenceId.issues)}`);
  const report = {
    schema: "workflow-report/v1",
    executionIdentity: executionId.identity,
    evidenceIdentity: evidenceId.identity,
    planIdentity: input.permission.planIdentity,
    candidateIdentity: input.evidence?.candidateIdentity ?? null,
    reviewIdentity: input.reviewIdentity,
    gateIdentity: input.gateIdentity,
    diff: input.diff,
    quality: input.quality === "pass" ? "passed" : input.quality === "fail" ? "failed" : "unknown",
    checks: input.evidence?.completeness ?? "incomplete",
    enforcement: input.evidence?.enforcement ?? "ineligible",
    unknowns: input.unknowns,
  };
  const chain = { plan: input.plan, workspace, authorization, execution, evidence, report };
  const checked = validateWorkflowRecordChain(chain);
  if (!checked.ok)
    throw new Error(`Invalid workflow record chain: ${JSON.stringify(checked.issues)}`);
  return chain;
}
