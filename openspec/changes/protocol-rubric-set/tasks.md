## 1. Issue, OpenSpec, and Initial PR

- [ ] 1.1 Confirm issue #38 owns only the contract, rubric set, and report shapes.
- [ ] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [ ] 1.3 Validate the change with OpenSpec strict validation.
- [ ] 1.4 Create the change PR with only OpenSpec artifacts first.

## 2. Schemas

- [ ] 2.1 Add `task-contract`, `rubric-set`, and `compilation-report` schemas with generated types.
- [ ] 2.2 Regenerate types and confirm existing generated files are unchanged.

## 3. Validation

- [ ] 3.1 Implement `validateTaskContract` with unique acceptance ids and class rules.
- [ ] 3.2 Implement `validateRubricSet` for proposal and frozen states.
- [ ] 3.3 Implement `validateRubricAgainstContract`.
- [ ] 3.4 Implement `validateCompilationReport` against the contract and rubric.
- [ ] 3.5 Implement `taskContractIdentity` and `rubricIdentity`.
- [ ] 3.6 Export the new API; results are values, never throws.

## 4. Tests

- [ ] 4.1 One test group per spec scenario, accepted and rejected.
- [ ] 4.2 Identity tests for order stability and change sensitivity.
- [ ] 4.3 Hostile-input tests.
- [ ] 4.4 Mutation checks for applicability, the report derivation, and the frozen rules.

## 5. Documentation

- [ ] 5.1 Update the `protocol` README with the contract, rubric, and report.

## 6. Verification and Review

- [ ] 6.1 Run `bun install --frozen-lockfile`.
- [ ] 6.2 Run `bun run validate`.
- [ ] 6.3 Run `openspec validate protocol-rubric-set --type change --strict`.
- [ ] 6.4 Import the built entrypoint in Node ESM and validate a contract, rubric, and report.
- [ ] 6.5 Independent review in a separate context and record the findings and resolution.

## 7. Final Gate

- [ ] 7.1 Update the PR body with commands, results, deferred work, and verification evidence.
- [ ] 7.2 Confirm every acceptance criterion in #38 has evidence.
