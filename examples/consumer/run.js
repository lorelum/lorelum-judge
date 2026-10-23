import { runCodeEvaluation } from "./code-evaluation.js";
import { runMockLlmReview } from "./mock-llm-review.js";
import { runProgramReview } from "./program-review.js";
import { runReviewToGate } from "./review-to-gate.js";

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
