import type { WorkflowAuthorization } from "./generated/workflow-authorization.js";
import type { WorkflowEvidence } from "./generated/workflow-evidence.js";
import type { WorkflowExecution } from "./generated/workflow-execution.js";
import type { WorkflowReport } from "./generated/workflow-report.js";
import type { WorkflowWorkspace } from "./generated/workflow-workspace.js";
import { identifyValidated, identityOf } from "./identity.js";
import type { IdentityOutcome } from "./measurement.js";
import authorizationSchema from "./schemas/workflow-authorization.schema.json" with {
  type: "json",
};
import evidenceSchema from "./schemas/workflow-evidence.schema.json" with { type: "json" };
import executionSchema from "./schemas/workflow-execution.schema.json" with { type: "json" };
import reportSchema from "./schemas/workflow-report.schema.json" with { type: "json" };
import workspaceSchema from "./schemas/workflow-workspace.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  schemaIssues,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";
import { validateWorkflowPlan, workflowPlanIdentity } from "./workflow-plan.js";

export type {
  WorkflowAuthorization,
  WorkflowEvidence,
  WorkflowExecution,
  WorkflowReport,
  WorkflowWorkspace,
};

const checkAuthorization = compileSchema<WorkflowAuthorization>(authorizationSchema);
const checkEvidence = compileSchema<WorkflowEvidence>(evidenceSchema);
const checkExecution = compileSchema<WorkflowExecution>(executionSchema);
const checkReport = compileSchema<WorkflowReport>(reportSchema);
const checkWorkspace = compileSchema<WorkflowWorkspace>(workspaceSchema);

// Only normalized, relative POSIX paths can identify workspace entries or directories.
function relativePath(path: string): boolean {
  return (
    path === "." ||
    (!path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== ".."))
  );
}
function issue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, code: "schema", message });
}
function result<T>(value: T, issues: ValidationIssue[]): ValidationResult<T> {
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

/** An inventory, not a grant to access the host workspace. */
export function validateWorkflowWorkspace(input: unknown): ValidationResult<WorkflowWorkspace> {
  return guarded<ValidationResult<WorkflowWorkspace>>(() => {
    const value = snapshot(input);
    if (!checkWorkspace(value)) return { ok: false, issues: schemaIssues(checkWorkspace.errors) };
    const issues: ValidationIssue[] = [];
    const paths = new Set<string>();
    value.files.forEach((file, i) => {
      if (!relativePath(file.path) || file.path === ".")
        issue(issues, `$.files[${i}].path`, "expected a normalized relative file path");
      if (paths.has(file.path)) issue(issues, `$.files[${i}].path`, "duplicate path");
      paths.add(file.path);
      if (file.excluded) {
        if (
          file.exclusionReason === null ||
          file.status !== "unknown" ||
          file.contentIdentity !== null ||
          file.mode !== null
        )
          issue(
            issues,
            `$.files[${i}]`,
            "excluded files require a reason and unknown, unread content",
          );
      } else if (
        file.exclusionReason !== null ||
        file.source === "unknown" ||
        file.status === "unknown" ||
        (file.status === "present"
          ? file.contentIdentity === null || file.mode === null
          : file.contentIdentity !== null || file.mode !== null)
      )
        issue(
          issues,
          `$.files[${i}]`,
          "included files require known source and consistent content metadata",
        );
    });
    return result(value, issues);
  }, failed);
}

/** A host decision record is descriptive only; it cannot authenticate or grant authority. */
export function validateWorkflowAuthorization(
  input: unknown,
): ValidationResult<WorkflowAuthorization> {
  return guarded<ValidationResult<WorkflowAuthorization>>(() => {
    const value = snapshot(input);
    if (!checkAuthorization(value))
      return { ok: false, issues: schemaIssues(checkAuthorization.errors) };
    const issues: ValidationIssue[] = [];
    for (const key of ["readPaths", "writePaths", "writablePaths", "commandReadPaths"] as const)
      value[key].forEach((path, i) => {
        if (!relativePath(path))
          issue(issues, `$.${key}[${i}]`, "expected a normalized relative path");
      });
    value.commands.forEach((command, i) => {
      if (!relativePath(command.cwd))
        issue(issues, `$.commands[${i}].cwd`, "expected a normalized relative path");
      if (command.executable.includes("\0") || command.args.some((arg) => arg.includes("\0")))
        issue(issues, `$.commands[${i}]`, "command contains NUL");
    });
    if (value.disclosures.length > 0 && value.modelRecipient === null)
      issue(issues, "$.modelRecipient", "disclosure requires a named recipient");
    if (
      value.expiresAt !== null &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.expiresAt) ||
        !Number.isFinite(Date.parse(value.expiresAt)) ||
        new Date(value.expiresAt).toISOString() !== value.expiresAt)
    )
      issue(issues, "$.expiresAt", "expected a canonical UTC timestamp");
    if ((value.verification === null) !== (value.verificationIdentity === null))
      issue(
        issues,
        "$.verificationIdentity",
        "verification and its identity must both be present or both null",
      );
    if (value.verification !== null) {
      const verificationId = identityOf(value.verification.schema, value.verification);
      if (!verificationId.ok || verificationId.identity !== value.verificationIdentity)
        issue(
          issues,
          "$.verificationIdentity",
          "verification identity does not match configuration",
        );
      const ids = new Set<string>();
      value.verification.checks.forEach((check, i) => {
        if (ids.has(check.id))
          issue(issues, `$.verification.checks[${i}].id`, "duplicate check id");
        ids.add(check.id);
        if (!relativePath(check.cwd))
          issue(issues, `$.verification.checks[${i}].cwd`, "expected a normalized relative path");
        check.readPaths.forEach((path, j) => {
          if (!relativePath(path))
            issue(
              issues,
              `$.verification.checks[${i}].readPaths[${j}]`,
              "expected a normalized relative path",
            );
          if (
            !value.commandReadPaths.some(
              (allowed) => allowed === "." || path === allowed || path.startsWith(`${allowed}/`),
            )
          )
            issue(
              issues,
              `$.verification.checks[${i}].readPaths[${j}]`,
              "check read path exceeds recorded command access",
            );
        });
        if (check.executable.includes("\0") || check.args.some((arg) => arg.includes("\0")))
          issue(issues, `$.verification.checks[${i}]`, "command contains NUL");
        if (
          !value.commands.some(
            (command) =>
              command.executable === check.executable &&
              command.cwd === check.cwd &&
              command.args.length === check.args.length &&
              command.args.every((arg, index) => arg === check.args[index]),
          )
        )
          issue(
            issues,
            `$.verification.checks[${i}]`,
            "check command is not recorded in authorization",
          );
        if (
          check.timeoutMs > value.limits.commandTimeMs ||
          check.maxOutputBytes > value.limits.outputBytes
        )
          issue(
            issues,
            `$.verification.checks[${i}]`,
            "check limits exceed recorded authorization",
          );
      });
    }
    return result(value, issues);
  }, failed);
}

export function validateWorkflowExecution(input: unknown): ValidationResult<WorkflowExecution> {
  return guarded<ValidationResult<WorkflowExecution>>(() => {
    const value = snapshot(input);
    return checkExecution(value)
      ? { ok: true, value }
      : { ok: false, issues: schemaIssues(checkExecution.errors) };
  }, failed);
}

export function validateWorkflowEvidence(input: unknown): ValidationResult<WorkflowEvidence> {
  return guarded<ValidationResult<WorkflowEvidence>>(() => {
    const value = snapshot(input);
    if (!checkEvidence(value)) return { ok: false, issues: schemaIssues(checkEvidence.errors) };
    const issues: ValidationIssue[] = [];
    const ids = new Set<string>();
    value.checks.forEach((check, i) => {
      if (ids.has(check.id)) issue(issues, `$.checks[${i}].id`, "duplicate check id");
      ids.add(check.id);
      if (!relativePath(check.cwd))
        issue(issues, `$.checks[${i}].cwd`, "expected a normalized relative path");
      if (check.status === "passed" && check.exitCode !== 0)
        issue(issues, `$.checks[${i}].exitCode`, "passed check requires exit code zero");
      if (check.status === "failed" && check.exitCode === 0)
        issue(issues, `$.checks[${i}].exitCode`, "failed check cannot have exit code zero");
      if (
        check.status === "not_started" &&
        (check.exitCode !== null || check.stdout !== "" || check.stderr !== "")
      )
        issue(
          issues,
          `$.checks[${i}]`,
          "a check that did not start cannot have an exit code or output",
        );
      if (
        value.candidateIdentity === null &&
        (check.status === "passed" || check.status === "failed")
      )
        issue(issues, `$.checks[${i}]`, "a completed check requires a candidate identity");
    });
    return result(value, issues);
  }, failed);
}

export function validateWorkflowReport(input: unknown): ValidationResult<WorkflowReport> {
  return guarded<ValidationResult<WorkflowReport>>(() => {
    const value = snapshot(input);
    if (!checkReport(value)) return { ok: false, issues: schemaIssues(checkReport.errors) };
    const issues: ValidationIssue[] = [];
    if (
      value.enforcement === "eligible" &&
      (value.candidateIdentity === null ||
        value.quality !== "passed" ||
        value.checks !== "complete" ||
        value.unknowns.length !== 0 ||
        value.reviewIdentity === null ||
        value.gateIdentity === null)
    )
      issue(
        issues,
        "$.enforcement",
        "eligibility requires a candidate, passing quality, complete checks, judge identities and no unknowns",
      );
    return result(value, issues);
  }, failed);
}

export function workflowWorkspaceIdentity(input: unknown): IdentityOutcome {
  return identifyValidated(validateWorkflowWorkspace(input));
}
export function workflowAuthorizationIdentity(input: unknown): IdentityOutcome {
  return identifyValidated(validateWorkflowAuthorization(input));
}
export function workflowExecutionIdentity(input: unknown): IdentityOutcome {
  return identifyValidated(validateWorkflowExecution(input));
}
export function workflowEvidenceIdentity(input: unknown): IdentityOutcome {
  return identifyValidated(validateWorkflowEvidence(input));
}
export function workflowReportIdentity(input: unknown): IdentityOutcome {
  return identifyValidated(validateWorkflowReport(input));
}

/** Validate linked records together. This verifies consistency, not current authorization. */
export function validateWorkflowRecordChain(input: {
  plan: unknown;
  workspace: unknown;
  authorization: unknown;
  execution: unknown;
  evidence: unknown;
  report: unknown;
}): ValidationResult<true> {
  return guarded<ValidationResult<true>>(() => {
    const copy = snapshot(input) as typeof input;
    const plan = validateWorkflowPlan(copy.plan);
    const workspace = validateWorkflowWorkspace(copy.workspace);
    const authorization = validateWorkflowAuthorization(copy.authorization);
    const execution = validateWorkflowExecution(copy.execution);
    const evidence = validateWorkflowEvidence(copy.evidence);
    const report = validateWorkflowReport(copy.report);
    const issues: ValidationIssue[] = [];
    for (const [name, validation] of Object.entries({
      plan,
      workspace,
      authorization,
      execution,
      evidence,
      report,
    })) {
      if (!validation.ok)
        for (const item of validation.issues)
          issues.push({ ...item, path: `$.${name}${item.path.slice(1)}` });
    }
    if (
      !plan.ok ||
      !workspace.ok ||
      !authorization.ok ||
      !execution.ok ||
      !evidence.ok ||
      !report.ok
    )
      return { ok: false, issues };
    const planId = workflowPlanIdentity(plan.value);
    const workspaceId = workflowWorkspaceIdentity(workspace.value);
    const authorizationId = workflowAuthorizationIdentity(authorization.value);
    const executionId = workflowExecutionIdentity(execution.value);
    const evidenceId = workflowEvidenceIdentity(evidence.value);
    if (!planId.ok || !workspaceId.ok || !authorizationId.ok || !executionId.ok || !evidenceId.ok)
      return failed({
        path: "$",
        code: "identity_mismatch",
        message: "could not identify records",
      });
    const mismatch = (path: string, matches: boolean) => {
      if (!matches)
        issues.push({ path, code: "identity_mismatch", message: "record binding does not match" });
    };
    mismatch("$.authorization.planIdentity", authorization.value.planIdentity === planId.identity);
    mismatch(
      "$.authorization.planRevision",
      authorization.value.planRevision === plan.value.revision,
    );
    mismatch(
      "$.authorization.workspaceIdentity",
      authorization.value.workspaceIdentity === workspaceId.identity,
    );
    mismatch("$.execution.planIdentity", execution.value.planIdentity === planId.identity);
    mismatch("$.execution.planRevision", execution.value.planRevision === plan.value.revision);
    mismatch(
      "$.execution.workspaceIdentity",
      execution.value.workspaceIdentity === workspaceId.identity,
    );
    mismatch(
      "$.execution.authorizationIdentity",
      execution.value.authorizationIdentity === authorizationId.identity,
    );
    mismatch(
      "$.evidence.executionIdentity",
      evidence.value.executionIdentity === executionId.identity,
    );
    mismatch("$.report.executionIdentity", report.value.executionIdentity === executionId.identity);
    mismatch("$.report.evidenceIdentity", report.value.evidenceIdentity === evidenceId.identity);
    mismatch("$.report.planIdentity", report.value.planIdentity === planId.identity);
    mismatch(
      "$.report.candidateIdentity",
      report.value.candidateIdentity === evidence.value.candidateIdentity,
    );
    const checkIds = new Set(plan.value.checks.map((check) => check.id));
    const configuredChecks = new Map(
      (authorization.value.verification?.checks ?? []).map((check) => [check.id, check]),
    );
    for (const [id] of configuredChecks)
      if (!checkIds.has(id))
        issue(issues, "$.authorization.verification.checks", `unknown plan check "${id}"`);
    for (const [i, check] of evidence.value.checks.entries()) {
      if (!checkIds.has(check.id))
        issue(issues, `$.evidence.checks[${i}].id`, "unknown plan check");
      const configured = configuredChecks.get(check.id);
      if (
        !configured ||
        configured.executable !== check.executable ||
        configured.cwd !== check.cwd ||
        configured.version !== check.version ||
        configured.environmentIdentity !== check.environmentIdentity ||
        configured.timeoutMs !== check.timeoutMs ||
        configured.maxOutputBytes !== check.maxOutputBytes ||
        configured.readPaths.length !== check.readPaths.length ||
        configured.readPaths.some((path, index) => path !== check.readPaths[index]) ||
        configured.args.length !== check.args.length ||
        configured.args.some((arg, index) => arg !== check.args[index])
      )
        issue(
          issues,
          `$.evidence.checks[${i}]`,
          "check does not match the recorded verification configuration",
        );
      if (
        (check.status === "passed" || check.status === "failed") &&
        !authorization.value.commands.some(
          (command) =>
            command.executable === check.executable &&
            command.cwd === check.cwd &&
            command.args.length === check.args.length &&
            command.args.every((arg, index) => arg === check.args[index]),
        )
      )
        issue(
          issues,
          `$.evidence.checks[${i}]`,
          "completed check command is not in the recorded authorization",
        );
    }
    const complete =
      evidence.value.checks.length === checkIds.size &&
      evidence.value.checks.every(
        (check) => check.status === "passed" || check.status === "failed",
      );
    if (report.value.checks === "complete" && !complete)
      issue(
        issues,
        "$.report.checks",
        "complete checks require a completed result for each plan check",
      );
    if (
      report.value.enforcement === "eligible" &&
      authorization.value.verification?.reviewConfigurationIdentity == null
    )
      issue(
        issues,
        "$.report.enforcement",
        "eligibility requires an identified review configuration",
      );
    if (
      report.value.enforcement === "eligible" &&
      evidence.value.checks.some(
        (check) =>
          check.status !== "passed" || check.version === null || check.environmentIdentity === null,
      )
    )
      issue(
        issues,
        "$.report.enforcement",
        "failed, incomplete or unprovenanced checks cannot be eligible",
      );
    return result(true as const, issues);
  }, failed);
}
