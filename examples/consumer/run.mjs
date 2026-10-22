import { runCodeEvaluation } from "./code-evaluation.mjs";
import { runMockLlmReview } from "./mock-llm-review.mjs";
import { runProgramReview } from "./program-review.mjs";
import { runReviewToGate } from "./review-to-gate.mjs";

const program = await runProgramReview();
console.log(
  `program review: completed=${program.completeness} attempts=${program.execution.attempts.length}`,
);

const llm = await runMockLlmReview();
console.log(
  `mock llm review: completed=${llm.completeness} model=${llm.execution.attempts[0]?.llm?.response?.model ?? "unknown"}`,
);

const gate = await runReviewToGate();
console.log(
  `review to gate: quality=${gate.decision.qualityOutcome} mode=${gate.decision.executionMode} enforcement=${gate.enforcementEligibility}`,
);

const evaluation = await runCodeEvaluation();
console.log(`code evaluation: ${JSON.stringify(evaluation)}`);
