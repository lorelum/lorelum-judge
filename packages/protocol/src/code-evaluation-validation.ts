import type {
  CodeEvaluationReport,
  CodeTarget,
  ReviewExecutionV2,
  ReviewPlan,
  ReviewResultContext,
  ReviewResultV2,
  SourceSnapshot,
} from "./code-evaluation.js";
import { assessCodeReviewResult } from "./code-evaluation-assessment.js";
import { deriveCodeEvaluationCompletion } from "./code-evaluation-completion.js";
import { sourceSnapshotIdentity, validateSourceSnapshot } from "./code-evaluation-source.js";
import { identifyValidated } from "./identity.js";
import { validateMeasurementDefinitionV2 } from "./measurement-v2.js";
import { validateReviewExecution } from "./measurement-v2-execution.js";
import schema from "./schemas/code-evaluation.schema.json" with { type: "json" };
import targetSchema from "./schemas/code-target.schema.json" with { type: "json" };
import executionSchema from "./schemas/review-execution-v2.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  prefixIssues,
  schemaIssues,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export { sourceSnapshotIdentity, validateSourceSnapshot } from "./code-evaluation-source.js";

compileSchema(schema);
const checkPlan = compileSchema<ReviewPlan>({ $ref: `${schema.$id}#/$defs/plan` });
const checkReport = compileSchema<CodeEvaluationReport>({ $ref: `${schema.$id}#/$defs/report` });
const checkExecution = compileSchema<ReviewExecutionV2>(executionSchema);
const checkTarget = compileSchema<CodeTarget>(targetSchema);
const issue = (path: string, message: string): ValidationIssue => ({
  path,
  code: "report_mismatch",
  message,
});

export function validateCodeTarget(raw: unknown): ValidationResult<CodeTarget> {
  return guarded<ValidationResult<CodeTarget>>(() => {
    const value = snapshot(raw);
    return checkTarget(value)
      ? { ok: true, value }
      : { ok: false, issues: schemaIssues(checkTarget.errors) };
  }, failed);
}

export function validateReviewPlan(
  raw: unknown,
  source?: SourceSnapshot,
): ValidationResult<ReviewPlan> {
  return guarded<ValidationResult<ReviewPlan>>(() => {
    const value = snapshot(raw);
    if (!checkPlan(value)) return { ok: false, issues: schemaIssues(checkPlan.errors) };
    const definition = validateMeasurementDefinitionV2(value.definition);
    if (!definition.ok)
      return { ok: false, issues: prefixIssues(definition.issues, "$.definition") };
    const issues: ValidationIssue[] = [];
    const ids = new Set<string>();
    for (const requirement of value.requirements) {
      if (ids.has(requirement.id))
        issues.push(issue("$.requirements", "requirement ids must be unique"));
      ids.add(requirement.id);
    }
    if (source !== undefined) {
      const identity = sourceSnapshotIdentity(source);
      if (!identity.ok) return identity;
      if (identity.identity !== value.sourceIdentity)
        issues.push(issue("$.sourceIdentity", "plan must bind this source snapshot"));
      const sourceIds = new Set(source.items.map((item) => item.id));
      for (const criterion of value.definition.criteria)
        for (const selector of criterion.evidence) {
          if (!sourceIds.has(selector.evidenceId))
            issues.push(issue("$.definition", "criterion references evidence absent from source"));
        }
    }
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}
export const reviewPlanIdentity = (raw: unknown) => identifyValidated(validateReviewPlan(raw));

/** Strict validation and salvage share the same typed entry checks and indexed context. */
export function validateReviewResultV2(
  raw: unknown,
  context: ReviewResultContext,
): ValidationResult<ReviewResultV2> {
  const assessed = assessCodeReviewResult(raw, context);
  return assessed.issues.length || assessed.result === undefined
    ? { ok: false, issues: assessed.issues }
    : { ok: true, value: assessed.result };
}

export function validateReviewExecutionV2(
  raw: unknown,
  plan: ReviewPlan,
  source: SourceSnapshot,
): ValidationResult<ReviewExecutionV2> {
  return guarded<ValidationResult<ReviewExecutionV2>>(() => {
    const value = snapshot(raw);
    if (!checkExecution(value)) return { ok: false, issues: schemaIssues(checkExecution.errors) };
    const { sourceIdentity, planIdentity, instrument, shownLines, followUpReferences, ...base } =
      value;
    const converted = {
      ...base,
      schema: "lorelum.judge.review-execution/v1",
      attempts: value.attempts.map(({ result: _result, rawResult: _raw, ...attempt }) => attempt),
    };
    const old = validateReviewExecution(converted, plan.definition, instrument);
    const issues: ValidationIssue[] = old.ok ? [] : [...old.issues];
    const checkedPlan = validateReviewPlan(plan, source);
    if (!checkedPlan.ok) issues.push(...prefixIssues(checkedPlan.issues, "$.plan"));
    if (
      instrument.method.parserVersion !== "lorelum.judge.review-parser/v2" ||
      (instrument.method.kind === "llm"
        ? instrument.method.compilerVersion !== "lorelum.judge.review-compiler/v2"
        : instrument.method.resultProtocolVersion !== "lorelum.judge.review-result/v2")
    )
      issues.push(
        issue("$.instrument", "v2 execution requires explicitly versioned v2 instrumentation"),
      );
    const sid = sourceSnapshotIdentity(source);
    const pid = reviewPlanIdentity(plan);
    if (!sid.ok || sid.identity !== sourceIdentity)
      issues.push(issue("$.sourceIdentity", "execution source identity mismatch"));
    if (!pid.ok || pid.identity !== planIdentity)
      issues.push(issue("$.planIdentity", "execution plan identity mismatch"));
    value.attempts.forEach((attempt, index) => {
      if (
        (attempt.status === "completed" || attempt.status === "partial") &&
        (!attempt.result || !attempt.evidenceBundle)
      )
        issues.push(
          issue(
            `$.attempts[${index}]`,
            "completed or partial v2 attempt needs its structured result",
          ),
        );
      if (
        (attempt.status === "failed" ||
          attempt.status === "cancelled" ||
          attempt.status === "not_started") &&
        attempt.result !== undefined
      )
        issues.push(
          issue(`$.attempts[${index}].result`, "non-assessed attempt cannot carry a result"),
        );
      if (attempt.result && attempt.evidenceBundle) {
        const result = validateReviewResultV2(attempt.result, {
          definition: plan.definition,
          source,
          manifest: attempt.evidenceBundle,
          projectionMode: instrument.method.kind === "llm" ? "escaped" : "plain",
          allowPartial: attempt.status === "partial",
          ...(shownLines === undefined
            ? {}
            : {
                shownLines: new Map(
                  Object.entries(shownLines).map(([id, lines]) => [id, new Set(lines)]),
                ),
              }),
          ...(followUpReferences === undefined ? {} : { followUpReferences }),
        });
        if (!result.ok) issues.push(...prefixIssues(result.issues, `$.attempts[${index}].result`));
        const measured = attempt.status === "completed" ? attempt.run?.verdicts : attempt.verdicts;
        const reported = new Map(
          attempt.result.verdicts.map((verdict) => [verdict.criterionId, verdict]),
        );
        if (
          measured === undefined ||
          measured.length !== reported.size ||
          measured.some((verdict) => {
            const other = reported.get(verdict.criterionId);
            return (
              other === undefined ||
              verdict.verdict !== other.verdict ||
              verdict.rationale !== other.rationale ||
              verdict.evidenceIds.length !== other.evidenceIds.length ||
              verdict.evidenceIds.some((id, index) => id !== other.evidenceIds[index])
            );
          })
        )
          issues.push(
            issue(`$.attempts[${index}].result.verdicts`, "result and measurement verdicts differ"),
          );
      }
    });
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}

export function validateCodeEvaluationReport(raw: unknown): ValidationResult<CodeEvaluationReport> {
  return guarded<ValidationResult<CodeEvaluationReport>>(() => {
    const value = snapshot(raw);
    if (!checkReport(value)) return { ok: false, issues: schemaIssues(checkReport.errors) };
    const source = validateSourceSnapshot(value.source);
    if (!source.ok) return source;
    const sid = sourceSnapshotIdentity(value.source);
    const issues: ValidationIssue[] = [];
    if (!sid.ok || sid.identity !== value.sourceIdentity)
      issues.push(issue("$.sourceIdentity", "report source identity mismatch"));
    if (value.plan) {
      const plan = validateReviewPlan(value.plan, value.source);
      if (!plan.ok) issues.push(...prefixIssues(plan.issues, "$.plan"));
      const pid = reviewPlanIdentity(value.plan);
      if (!pid.ok || pid.identity !== value.planIdentity)
        issues.push(issue("$.planIdentity", "report plan identity mismatch"));
    } else if (value.planIdentity || value.execution || value.result)
      issues.push(issue("$.plan", "execution and result require a plan"));
    if (value.execution && value.plan) {
      const execution = validateReviewExecutionV2(value.execution, value.plan, value.source);
      if (!execution.ok) issues.push(...prefixIssues(execution.issues, "$.execution"));
      if (
        value.result &&
        !value.execution.attempts.some(
          (a) => a.result && JSON.stringify(a.result) === JSON.stringify(value.result),
        )
      )
        issues.push(issue("$.result", "report result must come from a recorded attempt"));
    } else if (value.result) issues.push(issue("$.result", "result needs a recorded execution"));
    const completion = deriveCodeEvaluationCompletion(value);
    if (value.status !== completion.status)
      issues.push(issue("$.status", "report status must match its completion facts"));
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}
export const codeEvaluationReportIdentity = (raw: unknown) =>
  identifyValidated(validateCodeEvaluationReport(raw));
export const reviewExecutionIdentityV2 = (raw: unknown, plan: ReviewPlan, source: SourceSnapshot) =>
  identifyValidated(validateReviewExecutionV2(raw, plan, source));
export const reviewResultIdentityV2 = (raw: unknown, context: ReviewResultContext) =>
  identifyValidated(validateReviewResultV2(raw, context));
