import { executeReview } from "@lorelum/judge";
import { frozenRubricToDefinition } from "@lorelum/judge-protocol";

import { assert, evidence, frozenRubric, metVerdict } from "./shared.mjs";

/**
 * Program-checker example: the caller owns the check, Judge freezes the input,
 * calls it once, and validates the verdicts.
 */
export async function runProgramReview() {
  const converted = frozenRubricToDefinition(frozenRubric());
  assert(converted.ok, "frozen rubric conversion failed");
  let calls = 0;
  const result = await executeReview(
    {
      definition: converted.value,
      evidence,
      method: { kind: "program", checker: { id: "demo-checker", version: "1" } },
    },
    {
      checker: () => {
        calls += 1;
        return { verdicts: [metVerdict()] };
      },
    },
  );
  assert(result.ok, "program review returned validation issues");
  assert(calls === 1, "the default review must invoke the checker once");
  assert(result.value.completeness === "complete", "the program review is not complete");
  assert(result.value.execution.attempts[0]?.run !== undefined, "no complete measurement run");
  return result.value;
}
