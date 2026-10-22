import { assessVerdicts } from "./assessment.js";
import type { ReviewResultContext, ReviewResultV2 } from "./code-evaluation.js";
import { validateReviewResultV2 } from "./code-evaluation-validation.js";
import { compileSchema, type ValidationIssue } from "./validation.js";

const checks = {
  summary: compileSchema({
    $ref: "urn:lorelum:judge:code-evaluation:v1#/$defs/result/properties/summary/items",
  }),
  problems: compileSchema({ $ref: "urn:lorelum:judge:code-evaluation:v1#/$defs/problem" }),
  pending: compileSchema({ $ref: "urn:lorelum:judge:code-evaluation:v1#/$defs/pending" }),
  followUps: compileSchema({ $ref: "urn:lorelum:judge:code-evaluation:v1#/$defs/followUp" }),
};

/** Retains legal partial lists while keeping all original diagnostics and raw output in the attempt. */
export function assessCodeReviewResult(
  raw: unknown,
  context: ReviewResultContext,
): { result?: ReviewResultV2; issues: readonly ValidationIssue[] } {
  const checked = validateReviewResultV2(raw, context);
  if (checked.ok) return { result: checked.value, issues: [] };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { issues: checked.issues };
  const value = raw as Record<string, unknown>;
  const assessed = assessVerdicts(
    context.definition.criteria,
    Array.isArray(value.verdicts) ? value.verdicts : [],
    { bundle: context.manifest, requireAll: true },
  );
  if (assessed.verdicts.length === 0) return { issues: checked.issues };
  const result: ReviewResultV2 = {
    schema: "lorelum.judge.review-result/v2",
    verdicts: [...assessed.verdicts],
    summary: [],
    problems: [],
    pending: [],
    followUps: [],
  };
  const issues = [...checked.issues];
  for (const kind of ["problems", "pending", "followUps", "summary"] as const) {
    const entries = value[kind];
    if (!Array.isArray(entries)) continue;
    for (const [index, entry] of entries.entries()) {
      if (!checks[kind](entry)) continue;
      const candidate = { ...result, [kind]: [...result[kind], entry] };
      const validation = validateReviewResultV2(candidate, context);
      const prefix = `$.${kind}[${result[kind].length}]`;
      if (!validation.ok) {
        const invalid = validation.issues.filter((issue) => issue.path.startsWith(prefix));
        if (invalid.length > 0) {
          issues.push(
            ...invalid.map((issue) => ({
              ...issue,
              path: `$.${kind}[${index}]${issue.path.slice(prefix.length)}`,
            })),
          );
          continue;
        }
      }
      // Each list is validated by its JSON schema above and its provenance below.
      (result[kind] as unknown[]).push(entry);
    }
  }
  return { result, issues };
}
