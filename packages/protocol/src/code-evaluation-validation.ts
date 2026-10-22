import { assessVerdicts } from "./assessment.js";
import type {
  CodeEvaluationReport,
  CodeTarget,
  ReviewExecutionV2,
  ReviewPlan,
  ReviewResultContext,
  ReviewResultV2,
  SourceSnapshot,
} from "./code-evaluation.js";
import { projectCodeSource } from "./code-evaluation.js";
import { validateEvidenceBundle } from "./evidence.js";
import { identifyValidated, identityOf } from "./identity.js";
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

compileSchema(schema);
const checkSource = compileSchema<SourceSnapshot>({ $ref: `${schema.$id}#/$defs/source` });
const checkPlan = compileSchema<ReviewPlan>({ $ref: `${schema.$id}#/$defs/plan` });
const checkResult = compileSchema<ReviewResultV2>({ $ref: `${schema.$id}#/$defs/result` });
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

export function validateSourceSnapshot(raw: unknown): ValidationResult<SourceSnapshot> {
  return guarded<ValidationResult<SourceSnapshot>>(() => {
    const value = snapshot(raw);
    if (!checkSource(value)) return { ok: false, issues: schemaIssues(checkSource.errors) };
    const issues: ValidationIssue[] = [];
    const ids = new Set<string>();
    value.items.forEach((item, index) => {
      const path = `$.items[${index}]`;
      if (ids.has(item.id))
        issues.push(issue(`${path}.id`, "source ids must be unique across versions"));
      ids.add(item.id);
      const text = item.text.replace(/\r\n?/g, "\n");
      const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      if (item.endLine !== (lines === 0 ? 0 : item.startLine + lines - 1))
        issues.push(
          issue(
            path,
            "source range must match its text lines (terminal newline is not another line)",
          ),
        );
    });
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}
export const sourceSnapshotIdentity = (raw: unknown) =>
  identifyValidated(validateSourceSnapshot(raw));

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

/** Checks every structured citation; invalid entries are never silently removed. */
export function validateReviewResultV2(
  raw: unknown,
  context: ReviewResultContext,
): ValidationResult<ReviewResultV2> {
  return guarded<ValidationResult<ReviewResultV2>>(() => {
    const checkedSource = validateSourceSnapshot(context.source);
    if (!checkedSource.ok) return checkedSource;
    const checkedDefinition = validateMeasurementDefinitionV2(context.definition);
    if (!checkedDefinition.ok) return checkedDefinition;
    const checkedManifest = validateEvidenceBundle(context.manifest);
    if (!checkedManifest.ok) return checkedManifest;
    context = {
      ...context,
      source: checkedSource.value,
      definition: checkedDefinition.value,
      manifest: checkedManifest.value,
    };
    const value = snapshot(raw);
    if (!checkResult(value)) return { ok: false, issues: schemaIssues(checkResult.errors) };
    const issues = [
      ...assessVerdicts(context.definition.criteria, value.verdicts, {
        bundle: context.manifest,
        requireAll: context.allowPartial !== true,
      }).issues,
    ];
    const criteria = new Map(context.definition.criteria.map((c) => [c.id, c]));
    const source = new Map(context.source.items.map((item) => [item.id, item]));
    const visible = new Set(
      context.manifest.items
        .filter((item) => item.status === "present" || item.status === "contradiction")
        .filter((item) => item.render?.state !== "withheld")
        .map((item) => item.id),
    );
    const projectedLines = new Map<string, Set<number>>();
    for (const evidence of context.manifest.items) {
      const item = source.get(evidence.id);
      if (!item) {
        issues.push(
          issue("$.manifest", `evidence ${evidence.id} is absent from the source snapshot`),
        );
        continue;
      }
      if (evidence.status !== "present" && evidence.status !== "contradiction") continue;
      const numbered = projectCodeSource(item)
        .normalize("NFC")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""))
        .join("\n");
      const content = identityOf("lorelum.judge.evidence-content/v1", numbered);
      if (!content.ok || content.identity !== evidence.contentIdentity)
        issues.push(
          issue("$.manifest", `evidence ${evidence.id} does not project this source content`),
        );
      const escaped = numbered.replace(/<(\/?)(evidence)/gi, "&lt;$1$2");
      const projection = evidence.render;
      const plainLength = Array.from(numbered).length;
      const escapedCharacters = Array.from(escaped);
      if (
        projection &&
        projection.originalLength !== plainLength &&
        projection.originalLength !== escapedCharacters.length
      )
        issues.push(
          issue("$.manifest", `evidence ${evidence.id} has an invalid projection length`),
        );
      const characters =
        projection?.originalLength === escapedCharacters.length
          ? escapedCharacters
          : Array.from(numbered);
      const text =
        projection === undefined
          ? numbered
          : characters.slice(0, projection.renderedLength).join("");
      const completeLines = projection?.state === "withheld" ? [] : text.split("\n");
      if (projection?.state === "truncated") completeLines.pop();
      projectedLines.set(
        item.id,
        new Set(
          completeLines.flatMap((line) => {
            const match = /^(\d+):/.exec(line);
            return match === null ? [] : [Number(match[1])];
          }),
        ),
      );
    }
    const ids = new Set<string>();
    const checkIds = (entries: readonly string[], path: string, criterionId?: string) => {
      const declared =
        criterionId === undefined
          ? undefined
          : criteria.get(criterionId)?.evidence.map((e) => e.evidenceId);
      if (criterionId !== undefined && declared === undefined)
        issues.push(issue(path, "unknown criterion"));
      for (const id of entries)
        if (
          !source.has(id) ||
          !visible.has(id) ||
          (declared !== undefined && !declared.includes(id))
        )
          issues.push(issue(path, `evidence ${id} is not shown and declared for this claim`));
    };
    for (const [kind, entries] of [
      ["problems", value.problems],
      ["pending", value.pending],
      ["followUps", value.followUps],
    ] as const) {
      entries.forEach((entry, index) => {
        const path = `$.${kind}[${index}]`;
        if (ids.has(entry.id)) issues.push(issue(`${path}.id`, "result ids must be unique"));
        ids.add(entry.id);
        checkIds(
          entry.evidenceIds,
          `${path}.evidenceIds`,
          "criterionId" in entry ? entry.criterionId : undefined,
        );
      });
    }
    value.problems.forEach((problem, index) => {
      const path = `$.problems[${index}]`;
      const verdict = value.verdicts.find((entry) => entry.criterionId === problem.criterionId);
      if (
        verdict === undefined ||
        verdict.verdict === "unknown" ||
        verdict.verdict === "insufficient"
      )
        issues.push(
          issue(
            `${path}.criterionId`,
            "a confirmed problem needs a legal decisive criterion verdict",
          ),
        );
      for (const location of problem.locations) {
        const item = source.get(location.itemId);
        if (
          !item ||
          !problem.evidenceIds.includes(location.itemId) ||
          item.role === "requirement" ||
          item.role === "opinion" ||
          location.startLine < item.startLine ||
          location.endLine > item.endLine ||
          location.endLine < location.startLine
        ) {
          issues.push(
            issue(`${path}.locations`, "location must cite a code item and its original range"),
          );
          continue;
        }
        const shown = projectedLines.get(item.id);
        const recorded = context.shownLines?.get(item.id);
        for (let line = location.startLine; line <= location.endLine; line++)
          if (!shown?.has(line) || (recorded !== undefined && !recorded.has(line))) {
            issues.push(
              issue(`${path}.locations`, "location includes a line not completely shown"),
            );
            break;
          }
      }
      if (problem.attribution === "introduced" || problem.attribution === "amplified") {
        const codeEvidence = problem.evidenceIds.flatMap((id) => {
          const item = source.get(id);
          return item && (item.role === "target" || item.role === "context") ? [item] : [];
        });
        const related = context.source.comparisons.some((comparison) => {
          const old = codeEvidence.filter(
            (item) =>
              item.side === "old" && item.version === (comparison.mergeBase ?? comparison.base),
          );
          const current = codeEvidence.filter(
            (item) => item.side === "new" && item.version === comparison.head,
          );
          const locatedNew = current.filter((item) =>
            problem.locations.some((location) => location.itemId === item.id),
          );
          if (old.length > 0 && locatedNew.length > 0) return true;
          if (problem.attribution !== "introduced") return false;
          if (locatedNew.some((item) => comparison.addedPaths?.includes(item.path))) return true;
          return old.some(
            (item) =>
              comparison.deletedPaths?.includes(item.path) &&
              problem.locations.some((location) => location.itemId === item.id),
          );
        });
        if (!related)
          issues.push(
            issue(
              `${path}.attribution`,
              "regression attribution needs a matching version comparison, paired evidence or reader-established addition/deletion",
            ),
          );
      }
    });
    const references = new Set(
      context.followUpReferences ??
        context.source.items.filter((item) => item.role === "opinion").map((item) => item.id),
    );
    const followed = new Set<string>();
    value.followUps.forEach((entry, index) => {
      if (!references.has(entry.reference) || followed.has(entry.reference))
        issues.push(
          issue(
            `$.followUps[${index}].reference`,
            "follow-up must uniquely reference a supplied opinion or previous problem",
          ),
        );
      followed.add(entry.reference);
      if (
        entry.outcome !== "unresolved" &&
        !entry.evidenceIds.some(
          (id) => source.get(id)?.role === "target" || source.get(id)?.role === "context",
        )
      )
        issues.push(
          issue(
            `$.followUps[${index}].evidenceIds`,
            "a resolved assertion needs independent code evidence, not the original opinion",
          ),
        );
    });
    if (!context.allowPartial)
      for (const reference of references)
        if (!followed.has(reference))
          issues.push(issue("$.followUps", `missing follow-up for ${reference}`));
    const problems = new Map(value.problems.map((p) => [p.id, p]));
    value.summary.forEach((entry, index) => {
      checkIds(entry.evidenceIds, `$.summary[${index}].evidenceIds`);
      for (const id of entry.criterionIds)
        if (!criteria.has(id))
          issues.push(issue(`$.summary[${index}]`, "summary references unknown criterion"));
      for (const id of entry.problemIds)
        if (!problems.has(id))
          issues.push(issue(`$.summary[${index}]`, "summary references unknown problem"));
    });
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
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
        if (
          JSON.stringify(
            attempt.status === "completed" ? attempt.run?.verdicts : attempt.verdicts,
          ) !== JSON.stringify(attempt.result.verdicts)
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
    if (
      value.status === "completed" &&
      (!value.result ||
        !value.execution ||
        value.execution.attempts.some((a) => a.status !== "completed") ||
        !value.source.consistent ||
        value.source.issues.some((i) => i.fatal))
    )
      issues.push(
        issue("$.status", "completed report needs complete execution and consistent source"),
      );
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}
export const codeEvaluationReportIdentity = (raw: unknown) =>
  identifyValidated(validateCodeEvaluationReport(raw));
export const reviewExecutionIdentityV2 = (raw: unknown, plan: ReviewPlan, source: SourceSnapshot) =>
  identifyValidated(validateReviewExecutionV2(raw, plan, source));
export const reviewResultIdentityV2 = (raw: unknown, context: ReviewResultContext) =>
  identifyValidated(validateReviewResultV2(raw, context));
