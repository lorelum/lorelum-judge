## Context

`packages/judge` holds the prompt compiler (#7). `packages/protocol` owns the contract,
rubric, and report shapes and identities (#8a). `packages/runtime` owns `ModelPort`,
`ModelRequest` (with `runId`, `stepIndex`, `signal`), and `ModelResponse` (`message`,
`tool_calls`, `structured`). The judge package may call `ModelPort`; it must not import a
provider SDK or a framework.

## Decisions

1. Two layers.
   - Generation: render the contract's acceptance criteria as evidence, call the model,
     parse a `structured` response. Calls the caller's `ModelPort`; `runId`, `stepIndex`,
     and `signal` come from the caller.
   - Gate: deterministic checks on the proposal, with no model call.
2. Acceptance criteria are evidence. The contract's acceptance items render as evidence
   items with their ids, through the existing `compilePrompt` escaping and "data, not
   instructions" notice. Model `covers` references these ids. There is no second escaping
   rule.
3. Truncation fails. If any acceptance item is truncated, withheld, or cannot be
   rendered, compilation fails with category `prompt`. The model never sees a partial
   contract.
4. One call per contract. The whole contract is sent once. Exceeding `ruleBudget` fails
   with `rules_over_budget`. Splitting is not done here.
5. Structured output only. The response must be `kind: "structured"`. A `message` or
   `tool_calls` response fails with category `output`. The value is not parsed from free
   text.
6. Output is untrusted and never repaired. Each proposal goes through
   `validateCriterionDraft`. Any failure fails the compilation; the compiler does not fix
   fields or drop entries silently.
7. Gate rules (deterministic, category `gate`):
   - mandatory criteria carry a `user`, `policy`, or `contract` source;
   - `appliesTo` contains the task class or `*`; non-matching entries are reported as
     `not_applicable` and kept visible with their original `appliesTo`;
   - every `covers` id exists in the acceptance list. An unknown id fails the whole
     compilation, because it means the model did not read the contract;
   - `mergedFrom` names only existing proposal ids, and a merge is recorded only when
     declared;
   - undeclared overlap of covered acceptance ids is a conflict and blocks `complete`.
8. Report: covered, uncovered, merged, not_applicable, unsupported, conflict, and
   `complete`. `complete` is derived from those lists only.
9. Freeze: `freezeRubric` refuses unless the report is complete and every criterion has
   anchors. It produces `status: "frozen"`. No review record is required as input.
10. Failure categories: `model` (the port threw or the signal aborted), `output` (not
    structured, or fails draft validation), `gate` (rules 7), `prompt` (truncation,
    over budget, unrenderable). Each issue carries a path and the category.
11. Identity: `contractIdentity` through `taskContractIdentity`; rubric identity through
    `rubricIdentity`, binding contract, `contextIdentity`, instrument (model, decoding,
    prompt identity from `compilePrompt`, runtime, repetitions), and policy. The compiler
    does not hash or copy by itself.
12. Not done here: automatic retry, contract splitting, output repair, run creation, repo
    context selection, calibration, gate semantics (#9), migration (#10).

## Risks

- Overlap detection uses covered ids only; semantic overlap is not detected. The report
  says so.
- The model can claim `appliesTo: ["*"]` for a web-only criterion. The gate cannot see
  meaning. The entry stays visible in the report for review.
- The same contract and model may produce different proposals on another run. The
  frozen rubric is the fixed object; generation is not claimed to be reproducible.
