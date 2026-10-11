## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue owns only the compiler, not calibration or migration.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [x] 1.4 Create the change PR with only OpenSpec artifacts first.

## 2. Compiler

- [ ] 2.1 Implement applicability by `taskClass` and `*`.
- [ ] 2.2 Implement source and mandatory checks for proposals.
- [ ] 2.3 Implement anchor check; proposals without anchors never freeze.
- [ ] 2.4 Implement declared merge via `mergedFrom`; reject undeclared overlap as conflict.
- [ ] 2.5 Implement covered, uncovered, unsupported, and `complete` in the report.
- [ ] 2.6 Implement `freezeRubric`, refusing incomplete reports.
- [ ] 2.7 Bind identity through `rubricIdentity` and `taskContractIdentity`.

## 3. Tests

- [ ] 3.1 One test group per spec scenario, accepted and rejected.
- [ ] 3.2 Hostile-input tests: non-object, hostile getters, cycles, unknown class.
- [ ] 3.3 Mutation checks: applicability, anchor gate, declared merge, freeze gate.

## 4. Verification and Documentation

- [ ] 4.1 Run `bun run validate`, the Node ESM smoke test, and mutation checks.
- [ ] 4.2 Update `packages/judge/README.md` and archive the change after merge.
- [ ] 4.3 Independent review at the final SHA; record findings in the PR.
