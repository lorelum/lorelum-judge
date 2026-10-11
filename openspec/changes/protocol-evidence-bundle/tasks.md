## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #34 owns only the evidence bundle contract.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [x] 1.4 Create the change PR with only OpenSpec artifacts first.

## 2. Schemas

- [x] 2.1 Add `evidence-item` and `evidence-bundle` schemas with generated types.
- [x] 2.2 Regenerate types and confirm existing generated files are unchanged.

## 3. Validation

- [x] 3.1 Implement `validateEvidenceBundle` with item, render, contradiction, and
  duplicate rules.
- [x] 3.2 Implement `validateVerdictEvidence` with citation and support rules.
- [x] 3.3 Implement `evidenceBundleIdentity`.
- [x] 3.4 Export the new API and keep results as values, never throws.

## 4. Tests

- [x] 4.1 One test group per spec scenario, accepted and rejected.
- [x] 4.2 Identity tests for reorder stability and change sensitivity.
- [x] 4.3 Hostile-input test and a mutation check that the support rule is caught.

## 5. Documentation

- [x] 5.1 Update the `protocol` README with the evidence contract.

## 6. Verification and Review

- [x] 6.1 Run `bun install --frozen-lockfile`.
- [x] 6.2 Run `bun run validate`.
- [x] 6.3 Run `openspec validate protocol-evidence-bundle --type change --strict`.
- [x] 6.4 Import the built entrypoint in Node ESM and validate a bundle and a verdict.
- [ ] 6.5 Read back the PR and record AI review findings and resolution.

## 7. Final Gate

- [x] 7.1 Update the PR body with commands, results, deferred work, and
  verification evidence.
- [x] 7.2 Confirm every acceptance criterion in #34 has evidence.
