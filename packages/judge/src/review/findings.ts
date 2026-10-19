import type {
  MeasurementDefinitionV2,
  ReviewExecution,
  ReviewIssue,
  Verdict,
} from "@lorelum/judge-protocol";

import type { ReviewCompleteness, ReviewFinding } from "./types.js";

export interface Assessed {
  readonly verdicts: readonly Verdict[];
  readonly issues: readonly ReviewIssue[];
}

export function aggregateFindings(
  definition: MeasurementDefinitionV2,
  assessments: readonly Assessed[],
): ReviewFinding[] {
  const metadata = new Map(definition.metadata.map((entry) => [entry.criterionId, entry]));
  return definition.criteria.map((criterion) => {
    const verdicts = assessments.flatMap((assessment) =>
      assessment.verdicts.filter((verdict) => verdict.criterionId === criterion.id),
    );
    const issues = assessments.flatMap((assessment) =>
      assessment.issues.filter((issue) => issue.criterionId === criterion.id),
    );
    const verdict = verdicts[0];
    return {
      criterionId: criterion.id,
      disagreement: new Set(verdicts.map((entry) => entry.verdict)).size > 1,
      role: metadata.get(criterion.id)?.role ?? "decisive",
      required: metadata.get(criterion.id)?.role === "decisive" && criterion.mandatory,
      status: verdict !== undefined ? "assessed" : issues.length > 0 ? "invalid" : "missing",
      ...(verdict === undefined ? {} : { verdict }),
      issues,
    };
  });
}

export function reviewCompleteness(execution: ReviewExecution): ReviewCompleteness {
  const statuses = execution.attempts.map((attempt) => attempt.status);
  if (statuses.includes("cancelled")) return "cancelled";
  if (statuses.every((status) => status === "completed")) return "complete";
  if (statuses.every((status) => status === "not_started")) return "not_started";
  if (statuses.every((status) => status === "failed" || status === "not_started")) {
    return "failed";
  }
  return "partial";
}
