import type { CodeEvaluationReport } from "./code-evaluation.js";

export type CodeEvaluationCompletionReason =
  | "missing_target"
  | "missing_result"
  | "execution_incomplete"
  | "source_changed"
  | "source_omitted"
  | "material_incomplete"
  | "projection_limited"
  | "judgment_unknown"
  | "pending_observation"
  | "unresolved_follow_up"
  | "missing_follow_up"
  | "unexpected_follow_up"
  | "diagnostic"
  | "operation_failed"
  | "timeout"
  | "cancelled";

export interface CodeEvaluationCompletion {
  readonly status: CodeEvaluationReport["status"];
  readonly reasons: readonly CodeEvaluationCompletionReason[];
  readonly missingFollowUps: readonly string[];
  readonly unexpectedFollowUps: readonly string[];
}

type CompletionInput = Pick<
  CodeEvaluationReport,
  "source" | "execution" | "result" | "issues" | "preparation"
>;

/** Shared completion policy over recorded facts, never over presentation strings. */
export function deriveCodeEvaluationCompletion(report: CompletionInput): CodeEvaluationCompletion {
  const reasons = new Set<CodeEvaluationCompletionReason>();
  const { source, execution, result } = report;
  const hasTarget = source.items.some((item) => item.role === "target");
  if (!hasTarget) reasons.add("missing_target");
  if (!execution || !result) reasons.add("missing_result");
  for (const preparation of report.preparation) {
    if (preparation.status === "cancelled") reasons.add("cancelled");
    else if (preparation.status === "failed") reasons.add("operation_failed");
  }
  if (execution) {
    if (execution.attempts.some((attempt) => attempt.status === "cancelled"))
      reasons.add("cancelled");
    if (
      execution.attempts.length !== execution.plannedCount ||
      execution.attempts.some((attempt) => attempt.status !== "completed")
    )
      reasons.add("execution_incomplete");
    const rendered = execution.instrument.method.kind === "llm";
    if (
      execution.attempts.some((attempt) =>
        attempt.evidenceBundle?.items.some(
          (item) =>
            item.status !== "present" ||
            (item.render === undefined ? rendered : item.render.state !== "rendered"),
        ),
      )
    )
      reasons.add("projection_limited");
  }
  if (!source.consistent) reasons.add("source_changed");
  if (source.omitted.length > 0) reasons.add("source_omitted");
  if (source.items.some((item) => !item.complete)) reasons.add("material_incomplete");

  const requested = new Set(execution?.followUpReferences ?? []);
  const counts = new Map<string, number>();
  const unexpected = new Set<string>();
  if (result) {
    if (
      result.verdicts.some(
        (verdict) => verdict.verdict === "unknown" || verdict.verdict === "insufficient",
      )
    )
      reasons.add("judgment_unknown");
    if (result.pending.length > 0) reasons.add("pending_observation");
    for (const followUp of result.followUps) {
      counts.set(followUp.reference, (counts.get(followUp.reference) ?? 0) + 1);
      if (!requested.has(followUp.reference)) unexpected.add(followUp.reference);
      if (followUp.outcome === "unresolved") reasons.add("unresolved_follow_up");
    }
  }
  const missing: string[] = [];
  for (const reference of requested) {
    if (counts.get(reference) !== 1) missing.push(reference);
  }
  if (missing.length > 0) reasons.add("missing_follow_up");
  if (unexpected.size > 0) reasons.add("unexpected_follow_up");

  for (const observations of [source.issues, report.issues]) {
    for (const observation of observations) {
      switch (observation.code) {
        case "timeout":
          reasons.add("timeout");
          break;
        case "cancelled":
          reasons.add("cancelled");
          break;
        case "sources_failed":
        case "preparation_failed":
        case "evaluation_failed":
          reasons.add("operation_failed");
          break;
        case "source_changed":
          reasons.add("source_changed");
          break;
        case "missing_follow_up":
          reasons.add("missing_follow_up");
          break;
        case "unknown_follow_up":
          reasons.add("unexpected_follow_up");
          break;
        default:
          reasons.add("diagnostic");
          break;
      }
    }
  }
  const status: CodeEvaluationReport["status"] = reasons.has("timeout")
    ? "failed"
    : reasons.has("cancelled")
      ? "cancelled"
      : !hasTarget || !execution || !result
        ? "failed"
        : reasons.size > 0
          ? "partial"
          : "completed";
  return {
    status,
    reasons: [...reasons],
    missingFollowUps: missing,
    unexpectedFollowUps: [...unexpected],
  };
}
