import type { ValidateFunction } from "ajv";
import { type Assessment, assessVerdicts } from "./assessment.js";
import type {
  CodeProblem,
  FollowUp,
  PendingObservation,
  ReviewResultContext,
  ReviewResultV2,
} from "./code-evaluation.js";
import { projectCodeSource, projectVisibleCodeSource } from "./code-evaluation.js";
import { validateSourceSnapshot } from "./code-evaluation-source.js";
import { validateEvidenceBundle } from "./evidence.js";
import { normalizeEvidenceText } from "./evidence-text.js";
import { identityOf } from "./identity.js";
import { validateMeasurementDefinitionV2 } from "./measurement-v2.js";
import schema from "./schemas/code-evaluation.schema.json" with { type: "json" };
import {
  compileSchema,
  guarded,
  prefixIssues,
  schemaIssues,
  snapshot,
  type ValidationIssue,
} from "./validation.js";

compileSchema(schema);
// Keep the public envelope schema; typed list checks below own each entry exactly once.
const checkEnvelope = compileSchema<Record<string, unknown>>({
  ...schema.$defs.result,
  properties: Object.fromEntries(
    Object.entries(schema.$defs.result.properties).map(([key, value]) => [
      key,
      "items" in value ? { ...value, items: {} } : value,
    ]),
  ),
});
const checks = {
  summary: compileSchema<ReviewResultV2["summary"][number]>({
    $ref: `${schema.$id}#/$defs/result/properties/summary/items`,
  }),
  problems: compileSchema<CodeProblem>({ $ref: `${schema.$id}#/$defs/problem` }),
  pending: compileSchema<PendingObservation>({ $ref: `${schema.$id}#/$defs/pending` }),
  followUps: compileSchema<FollowUp>({ $ref: `${schema.$id}#/$defs/followUp` }),
};
const issue = (path: string, message: string): ValidationIssue => ({
  path,
  code: "report_mismatch",
  message,
});

/** Validate and index immutable context once for strict validation and partial recovery. */
function prepareContext(context: ReviewResultContext) {
  const source = validateSourceSnapshot(context.source);
  if (!source.ok) return source;
  const definition = validateMeasurementDefinitionV2(context.definition);
  if (!definition.ok) return definition;
  const manifest = validateEvidenceBundle(context.manifest);
  if (!manifest.ok) return manifest;
  const issues: ValidationIssue[] = [];
  const sources = new Map(source.value.items.map((item) => [item.id, item]));
  const projectedLines = new Map<string, ReadonlySet<number>>();
  const visible = new Set<string>();
  if (context.projectionMode !== "plain" && context.projectionMode !== "escaped")
    issues.push(issue("$.projectionMode", "an explicit projection mode is required"));
  for (const evidence of manifest.value.items) {
    const item = sources.get(evidence.id);
    if (!item) {
      issues.push(
        issue("$.manifest", `evidence ${evidence.id} is absent from the source snapshot`),
      );
      continue;
    }
    if (evidence.status !== "present" && evidence.status !== "contradiction") continue;
    const content = identityOf(
      "lorelum.judge.evidence-content/v1",
      normalizeEvidenceText(projectCodeSource(item)),
    );
    if (!content.ok || content.identity !== evidence.contentIdentity)
      issues.push(
        issue("$.manifest", `evidence ${evidence.id} does not project this source content`),
      );
    const projection = projectVisibleCodeSource(item, evidence.render, context.projectionMode);
    if (evidence.render && evidence.render.originalLength !== projection.originalLength)
      issues.push(issue("$.manifest", `evidence ${evidence.id} has an invalid projection length`));
    projectedLines.set(item.id, projection.completeLines);
    if (evidence.render?.state !== "withheld") visible.add(item.id);
  }
  if (issues.length) return { ok: false as const, issues };
  return {
    ok: true as const,
    value: {
      context: {
        ...context,
        source: source.value,
        definition: definition.value,
        manifest: manifest.value,
      },
      criteria: new Map(definition.value.criteria.map((criterion) => [criterion.id, criterion])),
      declarations: new Map(
        definition.value.criteria.map((criterion) => [
          criterion.id,
          new Set(criterion.evidence.map((entry) => entry.evidenceId)),
        ]),
      ),
      source: sources,
      visible,
      projectedLines,
      references: new Set(
        context.followUpReferences ??
          source.value.items.filter((item) => item.role === "opinion").map((item) => item.id),
      ),
    },
  };
}

interface Entry<T> {
  value: T;
  path: string;
}

function readEntries<T>(
  raw: unknown,
  kind: string,
  check: ValidateFunction<T>,
  issues: ValidationIssue[],
): Entry<T>[] {
  if (!Array.isArray(raw)) return [];
  const entries: Entry<T>[] = [];
  raw.forEach((entry, index) => {
    if (check(entry)) entries.push({ value: entry, path: `$.${kind}[${index}]` });
    else issues.push(...prefixIssues(schemaIssues(check.errors), `$.${kind}[${index}]`));
  });
  return entries;
}

export interface CodeReviewAssessment extends Assessment {
  readonly result?: ReviewResultV2;
}

/** One assessment owns normalized verdicts, diagnostics, and legal structured partials. */
export function assessCodeReviewResult(
  raw: unknown,
  input: ReviewResultContext,
): CodeReviewAssessment {
  return guarded<CodeReviewAssessment>(
    () => {
      const prepared = prepareContext(input);
      if (!prepared.ok) return { verdicts: [], issues: prepared.issues };
      const { context, criteria, declarations, source, visible, projectedLines, references } =
        prepared.value;
      const value = snapshot(raw);
      const shapeIssues = checkEnvelope(value) ? [] : schemaIssues(checkEnvelope.errors);
      const record =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const assessed = assessVerdicts(
        context.definition.criteria,
        Array.isArray(record.verdicts) ? record.verdicts : [],
        {
          bundle: context.manifest,
          requireAll: context.allowPartial !== true,
        },
      );
      const issues: ValidationIssue[] = [...shapeIssues, ...assessed.issues];
      const problems = readEntries(record.problems, "problems", checks.problems, issues);
      const pending = readEntries(record.pending, "pending", checks.pending, issues);
      const followUps = readEntries(record.followUps, "followUps", checks.followUps, issues);
      const summaries = readEntries(record.summary, "summary", checks.summary, issues);
      const ids = new Map<string, number>();
      const followed = new Map<string, number>();
      for (const entry of [...problems, ...pending, ...followUps])
        ids.set(entry.value.id, (ids.get(entry.value.id) ?? 0) + 1);
      for (const entry of followUps)
        followed.set(entry.value.reference, (followed.get(entry.value.reference) ?? 0) + 1);
      const verdicts = new Map(assessed.verdicts.map((verdict) => [verdict.criterionId, verdict]));
      const result: ReviewResultV2 = {
        schema: "lorelum.judge.review-result/v2",
        verdicts: [...assessed.verdicts],
        summary: [],
        problems: [],
        pending: [],
        followUps: [],
      };
      const checkIds = (entries: readonly string[], path: string, criterionId?: string) => {
        const criterion = criterionId === undefined ? undefined : criteria.get(criterionId);
        if (criterionId !== undefined && criterion === undefined)
          issues.push(issue(path, "claim references unknown criterion"));
        const declared = criterionId === undefined ? undefined : declarations.get(criterionId);
        for (const id of entries)
          if (!source.has(id) || !visible.has(id) || (declared !== undefined && !declared.has(id)))
            issues.push(issue(path, `evidence ${id} is not shown and declared for this claim`));
      };
      const checkCommon = (entry: CodeProblem | PendingObservation | FollowUp, path: string) => {
        if ((ids.get(entry.id) ?? 0) > 1)
          issues.push(issue(`${path}.id`, "result ids must be unique"));
        checkIds(
          entry.evidenceIds,
          `${path}.evidenceIds`,
          "criterionId" in entry ? entry.criterionId : undefined,
        );
      };
      for (const { value: problem, path } of problems) {
        const before = issues.length;
        checkCommon(problem, path);
        const verdict = verdicts.get(problem.criterionId);
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
        if (issues.length === before) result.problems.push(problem);
      }
      for (const { value: entry, path } of pending) {
        const before = issues.length;
        checkCommon(entry, path);
        if (issues.length === before) result.pending.push(entry);
      }
      for (const { value: entry, path } of followUps) {
        const before = issues.length;
        checkCommon(entry, path);
        if (!references.has(entry.reference) || (followed.get(entry.reference) ?? 0) > 1)
          issues.push(
            issue(
              `${path}.reference`,
              "follow-up must uniquely reference a supplied opinion or previous problem",
            ),
          );
        if (
          entry.outcome !== "unresolved" &&
          !entry.evidenceIds.some(
            (id) => source.get(id)?.role === "target" || source.get(id)?.role === "context",
          )
        )
          issues.push(
            issue(
              `${path}.evidenceIds`,
              "a resolved assertion needs independent code evidence, not the original opinion",
            ),
          );
        if (issues.length === before) result.followUps.push(entry);
      }
      if (!context.allowPartial)
        for (const reference of references)
          if (!followed.has(reference))
            issues.push(issue("$.followUps", `missing follow-up for ${reference}`));
      const retainedProblems = new Set(result.problems.map((entry) => entry.id));
      for (const { value: entry, path } of summaries) {
        const before = issues.length;
        checkIds(entry.evidenceIds, `${path}.evidenceIds`);
        for (const id of entry.criterionIds)
          if (!criteria.has(id)) issues.push(issue(path, "summary references unknown criterion"));
        for (const id of entry.problemIds)
          if (!retainedProblems.has(id))
            issues.push(issue(path, "summary references unknown problem"));
        if (issues.length === before) result.summary.push(entry);
      }
      if (result.verdicts.length === 0 && issues.length === 0)
        issues.push(issue("$.verdicts", "a result needs at least one legal verdict"));
      return {
        verdicts: result.verdicts,
        issues,
        ...(result.verdicts.length === 0 ? {} : { result }),
      };
    },
    (failure) => ({ verdicts: [], issues: [failure] }),
  );
}
