## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #38 owns only the contract, rubric set, and report shapes.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [x] 1.4 Create the change PR with only OpenSpec artifacts first.

## 2. Schemas

- [x] 2.1 Add `task-contract`, `rubric-set`, and `compilation-report` schemas with generated types.
- [x] 2.2 Regenerate types and confirm existing generated files are unchanged.

## 3. Validation

- [x] 3.1 Implement `validateTaskContract` with unique acceptance ids and class rules.
- [x] 3.2 Implement `validateRubricSet` for proposal and frozen states.
- [x] 3.3 Implement `validateRubricAgainstContract`.
- [x] 3.4 Implement `validateCompilationReport` against the contract and rubric.
- [x] 3.5 Implement `taskContractIdentity` and `rubricIdentity`.
- [x] 3.6 Export the new API; results are values, never throws.

## 4. Tests

- [x] 4.1 One test group per spec scenario, accepted and rejected.
- [x] 4.2 Identity tests for order stability and change sensitivity.
- [x] 4.3 Hostile-input tests.
- [x] 4.4 Mutation checks for applicability, the report derivation, and the frozen rules.

## 5. Documentation

- [x] 5.1 Update the `protocol` README with the contract, rubric, and report.

## 6. Verification and Review

- [x] 6.1 Run `bun install --frozen-lockfile`.
- [x] 6.2 Run `bun run validate`.
- [x] 6.3 Run `openspec validate protocol-rubric-set --type change --strict`.
- [x] 6.4 Import the built entrypoint in Node ESM and validate a contract, rubric, and report.
- [x] 6.5 Independent review in a separate context and record the findings and resolution.

## 7. Final Gate

- [x] 7.1 Update the PR body with commands, results, deferred work, and verification evidence.
- [x] 7.2 Confirm every acceptance criterion in #38 has evidence.

## 8. Review Fixes (changes requested on the PR)

- [x] 8.1 Snapshot untrusted input once in every public function; add inherited-field and stateful-getter tests.
- [x] 8.2 Proposal keeps every anchor and evidence-selector rule except missing anchors; the dead draft call now has a job.
- [x] 8.3 Report: one merged record per survivor, an absorbed id goes to one survivor, whitespace-only reasons rejected.
- [x] 8.4 Add the missing tests (exactly one list, gap-list unknown ids, appliesTo and rubric id in the identity, wildcard contract) and mutation-check them.
- [x] 8.5 Report a duplicate criterion id once in the frozen state.
- [x] 8.6 Replace the three local `failed` helpers with the shared one.
- [x] 8.7 Correct the dist-smoke requirement to the existing import check; keep the behavioural run as PR evidence.
- [x] 8.8 Record the independent review (bbf7b3f) and its resolution in the PR.
- [x] 8.9 Apply the snapshot to the earlier protocol APIs too (`criterion`, `evidence`, `measurement`, `enforcement`), so "each public function" is true; add an inherited-field case for each and a read-once case for definition, bundle, and enforcement.
- [x] 8.10 Make the stateful-contract rubric test able to fail (exactly one read, unconditional identity comparison).
- [x] 8.11 State that `merged` records are caller-supplied and unverified; verification needs the proposal set (#8b).
- [x] 8.12 Re-run the independent review on the new commit and record it in the PR.

