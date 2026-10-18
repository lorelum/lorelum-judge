import type { ReviewAttempt, Verdict } from "@lorelum/judge-protocol";

import type { LlmFacts, PreparedReview, ReviewFailure } from "./types.js";

export interface AttemptContext {
  readonly id: string;
  readonly index: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly manifest: PreparedReview["manifest"];
}

export function failedAttempt(
  context: AttemptContext,
  failure: ReviewFailure,
  options: {
    readonly llm?: LlmFacts;
    readonly issues?: ReviewAttempt["issues"];
  } = {},
): ReviewAttempt {
  return {
    id: context.id,
    index: context.index,
    status: "failed",
    startedAt: context.startedAt,
    finishedAt: context.finishedAt,
    evidenceBundle: context.manifest,
    ...(options.llm === undefined ? {} : { llm: options.llm }),
    ...(options.issues === undefined ? {} : { issues: options.issues }),
    failure,
  };
}

export function completedAttempt(
  context: AttemptContext,
  prepared: PreparedReview,
  executionId: string,
  runId: string,
  verdicts: readonly Verdict[],
  llm: LlmFacts | undefined,
): ReviewAttempt {
  return {
    id: context.id,
    index: context.index,
    status: "completed",
    startedAt: context.startedAt,
    finishedAt: context.finishedAt,
    evidenceBundle: context.manifest,
    run: {
      schema: "lorelum.judge.measurement-run/v2",
      id: runId,
      definitionIdentity: prepared.definitionIdentity,
      instrumentIdentity: prepared.instrumentIdentity,
      instrumentSource: "declared",
      executionId,
      evidenceIdentity: prepared.evidenceIdentity,
      ...(prepared.renderIdentity === undefined ? {} : { renderIdentity: prepared.renderIdentity }),
      verdicts: [...verdicts],
    },
    ...(llm === undefined ? {} : { llm }),
  };
}

export function partialAttempt(
  context: AttemptContext,
  verdicts: readonly Verdict[],
  issues: readonly NonNullable<ReviewAttempt["issues"]>[number][],
  llm: LlmFacts | undefined,
): ReviewAttempt {
  return {
    id: context.id,
    index: context.index,
    status: "partial",
    startedAt: context.startedAt,
    finishedAt: context.finishedAt,
    evidenceBundle: context.manifest,
    verdicts: [...verdicts],
    issues: [...issues],
    ...(llm === undefined ? {} : { llm }),
  };
}

export function notStartedAttempt(id: string, index: number): ReviewAttempt {
  return { id, index, status: "not_started" };
}

export function cancelledAttempt(context: AttemptContext): ReviewAttempt {
  return {
    id: context.id,
    index: context.index,
    status: "cancelled",
    startedAt: context.startedAt,
    finishedAt: context.finishedAt,
  };
}
