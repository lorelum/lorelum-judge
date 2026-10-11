## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue owns only the compiler, not calibration or migration.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [x] 1.4 Create the change PR with only OpenSpec artifacts first.
- [x] 1.5 Revise the OpenSpec change to the generation-plus-gate design; validate and push.

## 2. Generation

- [x] 2.1 Render acceptance items as evidence ids through `compilePrompt`.
- [x] 2.2 Fail with category `prompt` on truncation, withheld, or unrenderable items.
- [x] 2.3 Call `ModelPort.generate` once; require `structured`; pass caller ids and signal.
- [x] 2.4 Map model errors to category `model`; map output errors to category `output`.
- [x] 2.5 Validate each proposal with `validateCriterionDraft`; never repair.

## 3. Gate

- [x] 3.1 Implement source check for mandatory proposals.
- [x] 3.2 Implement applicability by task class and `*`; keep `appliesTo` visible.
- [x] 3.3 Reject `covers` ids not in the contract.
- [x] 3.4 Implement declared merge via `mergedFrom`; undeclared overlap is a conflict.
- [x] 3.5 Implement covered, uncovered, unsupported, and `complete` in the report.
- [x] 3.6 Implement `freezeRubric`, refusing incomplete reports and missing anchors.
- [x] 3.7 Bind identity through `taskContractIdentity` and `rubricIdentity`.

## 4. Tests

- [x] 4.1 One test group per spec scenario, accepted and rejected, using an inline fake `ModelPort`. The judge test policy does not allow importing `@lorelum/judge-testing`, so `createScriptedModel` is not used.
- [x] 4.2 Hostile model output: throwing getter, non-object, unreadable.
- [x] 4.3 Mutation checks for each gate rule and for the truncation, abort, and structured-output rules. Ten mutations, all caught.

## 5. Verification and Documentation

- [x] 5.1 Run `bun run validate` (563 pass, Node ESM load OK) and mutation checks.
- [x] 5.2 Update `packages/judge/README.md`; record repo context as deferred.
- [ ] 5.3 Independent review at the final SHA; record findings in the PR.
- [ ] 5.4 Archive the change after merge.
