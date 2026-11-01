import { isRecord } from "../type-guards.js";
import { runPreparedReview } from "./execute.js";
import { prepareReview } from "./input.js";
import type { ExecuteReviewInput, ExecuteReviewResult, ReviewPorts } from "./types.js";
import { validation } from "./validation.js";

export type { ValidationResult } from "@lorelum/judge-protocol";
export { parseJsonObject } from "../review-parser.js";
export * from "./code-execute.js";
export { runPreparedReview } from "./execute.js";
export { reviewCompleteness } from "./findings.js";
export { prepareReview } from "./input.js";
export * from "./types.js";

async function execute(input: unknown, ports: ReviewPorts): Promise<ExecuteReviewResult> {
  const signal = isRecord(input) && input.signal instanceof AbortSignal ? input.signal : undefined;
  const prepared = prepareReview(input, ports);
  if (!prepared.ok) return prepared;
  return runPreparedReview(prepared.value, ports, signal);
}

/**
 * Executes one review by default. Inputs are validated and copied before any
 * checker or model call; later mutation of the caller's object cannot change the
 * running review. Explicit repetitions run sequentially with no retry or cache.
 */
export async function executeReview(
  input: ExecuteReviewInput,
  ports: ReviewPorts,
): Promise<ExecuteReviewResult> {
  try {
    return await execute(input, ports);
  } catch (error) {
    return {
      ok: false,
      issues: [
        validation(
          "$",
          `review input could not be read: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        ),
      ],
    };
  }
}
