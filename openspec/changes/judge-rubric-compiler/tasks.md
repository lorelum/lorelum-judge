## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue owns only the compiler, not calibration or migration.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [x] 1.4 Create the change PR with only OpenSpec artifacts first.
- [x] 1.5 Revise the OpenSpec change to the generation-plus-gate design; validate and push.

## 2. Generation

- [ ] 2.1 Render acceptance items as evidence ids through `compilePrompt`.
- [ ] 2.2 Fail with category `prompt` on truncation, withheld, or unrenderable items.
- [ ] 2.3 Call `ModelPort.generate` once; require `structured`; pass caller ids and signal.
- [ ] 2.4 Map model errors to category `model`; map output errors to category `output`.
- [ ] 2.5 Validate each proposal with `validateCriterionDraft`; never repair.

## 3. Gate

- [ ] 3.1 Implement source check for mandatory proposals.
- [ ] 3.2 Implement applicability by task class and `*`; keep `appliesTo` visible.
- [ ] 3.3 Reject `covers` ids not in the contract.
- [ ] 3.4 Implement declared merge via `mergedFrom`; undeclared overlap is a conflict.
- [ ] 3.5 Implement covered, uncovered, unsupported, and `complete` in the report.
- [ ] 3.6 Implement `freezeRubric`, refusing incomplete reports and missing anchors.
- [ ] 3.7 Bind identity through `taskContractIdentity` and `rubricIdentity`.

## 4. Tests

- [ ] 4.1 One test group per spec scenario, accepted and rejected, using `createScriptedModel`.
- [ ] 4.2 Hostile model output: throwing getter, cycle, non-object.
- [ ] 4.3 Mutation checks for each gate rule and for the truncation rule.

## 5. Verification and Documentation

- [ ] 5.1 Run `bun run validate`, the Node ESM smoke test, and mutation checks.
- [ ] 5.2 Update `packages/judge/README.md`; record repo context as deferred.
- [ ] 5.3 Independent review at the final SHA; record findings in the PR.
