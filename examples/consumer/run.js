import { runCodeEvaluation } from "./code-evaluation.js";
import { runCodeSuggestions } from "./code-suggestions.js";
import { runMockLlmReview } from "./mock-llm-review.js";
import { runProgramReview } from "./program-review.js";
import { runReviewToGate } from "./review-to-gate.js";
import { runWorkflowExecution } from "./workflow-execution.js";
import { runWorkflowPlanning } from "./workflow-planning.js";

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
const suggestions = await runCodeSuggestions();
console.log(`code suggestions: ${JSON.stringify(suggestions)}`);
const workflow = await runWorkflowPlanning();
console.log(`workflow planning: ${JSON.stringify(workflow)}`);
const execution = await runWorkflowExecution();
console.log(`workflow execution: ${JSON.stringify(execution)}`);
