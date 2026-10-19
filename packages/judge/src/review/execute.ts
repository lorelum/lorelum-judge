import { randomUUID } from "node:crypto";

import {
  type ReviewAttempt,
  type ReviewExecution,
  validateReviewExecution,
} from "@lorelum/judge-protocol";

import { executeAttempt } from "./execute-attempt.js";
import { type Assessed, aggregateFindings, reviewCompleteness } from "./findings.js";
import { notStartedAttempt } from "./record.js";
import type { ExecuteReviewResult, PreparedReview, ReviewPorts } from "./types.js";
import { validation } from "./validation.js";

async function runPreparedReviewInner(
  prepared: PreparedReview,
  ports: ReviewPorts,
  signal?: AbortSignal,
): Promise<ExecuteReviewResult> {
  const nextId = ports.nextId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);
  const clock = ports.clock ?? { now: () => new Date() };
  const executionId = prepared.id ?? nextId("review");
  const attempts: ReviewAttempt[] = [];
  const assessments: Assessed[] = [];
  const activeSignal = signal ?? new AbortController().signal;

  for (let index = 0; index < prepared.repetitions; index += 1) {
    const id = nextId("attempt");
    if (activeSignal.aborted) {
      attempts.push(notStartedAttempt(id, index));
      continue;
    }
    const startedAt = clock.now().toISOString();
    const outcome = await executeAttempt(
      prepared,
      ports,
      activeSignal,
      { id, index, startedAt, finishedAt: startedAt, manifest: prepared.manifest },
      executionId,
      nextId,
      clock,
    );
    attempts.push(outcome.attempt);
    if (outcome.assessed !== undefined) assessments.push(outcome.assessed);
  }

  const first = attempts[0];
  if (first === undefined) {
    return { ok: false, issues: [validation("$.attempts", "a review needs at least one attempt")] };
  }
  const attemptTuple: [ReviewAttempt, ...ReviewAttempt[]] = [first, ...attempts.slice(1)];
  const execution: ReviewExecution = {
    schema: "lorelum.judge.review-execution/v1",
    id: executionId,
    inputIdentity: prepared.inputIdentity,
    definitionIdentity: prepared.definitionIdentity,
    instrumentIdentity: prepared.instrumentIdentity,
    plannedCount: prepared.repetitions,
    attempts: attemptTuple,
  };
  const checked = validateReviewExecution(execution, prepared.definition, prepared.instrument);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  return {
    ok: true,
    value: {
      definition: prepared.definition,
      instrument: prepared.instrument,
      execution: checked.value,
      findings: aggregateFindings(prepared.definition, assessments),
      completeness: reviewCompleteness(checked.value),
    },
  };
}

export async function runPreparedReview(
  prepared: PreparedReview,
  ports: ReviewPorts,
  signal?: AbortSignal,
): Promise<ExecuteReviewResult> {
  try {
    return await runPreparedReviewInner(prepared, ports, signal);
  } catch (error) {
    return {
      ok: false,
      issues: [
        validation(
          "$",
          `prepared review could not run: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        ),
      ],
    };
  }
}
