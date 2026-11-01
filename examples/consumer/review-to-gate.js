import { evaluateReviewGate } from "@lorelum/judge";

import { runProgramReview } from "./program-review.js";
import { assert, policyFor } from "./shared.js";

/**
 * Execution-to-gate example: the complete review is projected onto #9 semantics.
 * There is no calibration here, so the result is advisory and cannot block.
 */
export async function runReviewToGate() {
  const review = await runProgramReview();
  const result = evaluateReviewGate({
    id: "demo-decision",
    taskClass: "code",
    evidenceShape: "code",
    execution: review.execution,
    definition: review.definition,
    instrument: review.instrument,
    policy: policyFor(review.definition, review.instrument),
    now: new Date().toISOString(),
  });
  assert(result.ok, "execution-to-gate returned validation issues");
  assert(result.value.completeness === "complete", "execution-to-gate lost completeness");
  assert(
    result.value.decision.qualityOutcome === "pass",
    "acceptable required finding did not pass",
  );
  assert(
    result.value.decision.executionMode === "diagnostic",
    "uncalibrated review must stay advisory",
  );
  assert(result.value.enforcementEligibility === false, "uncalibrated review cannot enforce");
  assert(
    result.value.reasons.includes("calibration_unavailable"),
    "missing calibration is not explained",
  );
  return result.value;
}
