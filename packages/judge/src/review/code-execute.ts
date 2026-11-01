import {
  type ReviewAttemptV2,
  type ReviewExecutionV2,
  type ReviewPlan,
  type ReviewResultV2,
  reviewPlanIdentity,
  type SourceSnapshot,
  sourceSnapshotIdentity,
  type ValidationIssue,
  validateReviewExecutionV2,
} from "@lorelum/judge-protocol";
import { collectReviewAttempts } from "./execute.js";
import { prepareReview } from "./input.js";
import type { ExecuteReviewInput, ReviewCompleteness, ReviewPorts } from "./types.js";

export type ExecuteCodeReviewResult =
  | {
      ok: true;
      value: {
        execution: ReviewExecutionV2;
        result?: ReviewResultV2;
        completeness: ReviewCompleteness;
      };
    }
  | { ok: false; issues: readonly ValidationIssue[] };

export async function executeCodeReview(
  input: ExecuteReviewInput & {
    plan: ReviewPlan;
    source: SourceSnapshot;
    followUpReferences?: readonly string[];
  },
  ports: ReviewPorts,
): Promise<ExecuteCodeReviewResult> {
  try {
    const prepared = prepareReview(input, ports, {
      plan: input.plan,
      source: input.source,
      ...(input.followUpReferences === undefined
        ? {}
        : { followUpReferences: input.followUpReferences }),
    });
    if (!prepared.ok) return prepared;
    const code = prepared.value.codeReview;
    if (code === undefined)
      return {
        ok: false,
        issues: [{ path: "$", code: "schema", message: "missing code review context" }],
      };
    const sourceId = sourceSnapshotIdentity(code.source);
    const planId = reviewPlanIdentity(code.plan);
    if (!sourceId.ok) return sourceId;
    if (!planId.ok) return planId;
    const collected = await collectReviewAttempts(prepared.value, ports, input.signal);
    const outcomes = new Map(collected.outcomes.map((outcome) => [outcome.attempt.id, outcome]));
    const attempts: ReviewAttemptV2[] = collected.attempts.map((attempt) => {
      const outcome = outcomes.get(attempt.id);
      return {
        ...attempt,
        ...(outcome?.result === undefined ? {} : { result: outcome.result }),
        ...(outcome?.rawResult === undefined ? {} : { rawResult: outcome.rawResult }),
      };
    });
    const first = attempts[0];
    if (!first)
      return {
        ok: false,
        issues: [{ path: "$.attempts", code: "schema", message: "no planned attempt" }],
      };
    const execution: ReviewExecutionV2 = {
      schema: "lorelum.judge.review-execution/v2",
      id: collected.executionId,
      inputIdentity: prepared.value.inputIdentity,
      definitionIdentity: prepared.value.definitionIdentity,
      instrumentIdentity: prepared.value.instrumentIdentity,
      instrument: prepared.value.instrument,
      sourceIdentity: sourceId.identity,
      planIdentity: planId.identity,
      plannedCount: prepared.value.repetitions,
      attempts: [first, ...attempts.slice(1)],
      ...(code.followUpReferences === undefined
        ? {}
        : { followUpReferences: [...code.followUpReferences] }),
    };
    const checked = validateReviewExecutionV2(execution, code.plan, code.source);
    if (!checked.ok) return checked;
    const statuses = attempts.map((attempt) => attempt.status);
    const completeness: ReviewCompleteness =
      statuses.includes("cancelled") || input.signal?.aborted
        ? "cancelled"
        : statuses.every((status) => status === "completed")
          ? "complete"
          : statuses.some((status) => status === "completed" || status === "partial")
            ? "partial"
            : statuses.every((status) => status === "not_started")
              ? "not_started"
              : "failed";
    const result = attempts.find((attempt) => attempt.result !== undefined)?.result;
    return {
      ok: true,
      value: {
        execution: checked.value,
        completeness,
        ...(result === undefined ? {} : { result }),
      },
    };
  } catch {
    return {
      ok: false,
      issues: [{ path: "$", code: "schema", message: "code review lifecycle failed" }],
    };
  }
}
