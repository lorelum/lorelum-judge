## 1. Contract Design and Validation

- [ ] 1.1 Define v2 dataset, policy, report, artifact, and decision schemas and canonical identities.
- [ ] 1.2 Validate this change with `openspec validate judge-calibration-gate --type change --strict`.
- [ ] 1.3 Create the change PR with OpenSpec artifacts before source implementation.

## 2. Protocol

- [ ] 2.1 Add schemas, generated types, validators, and identity helpers for v2 calibration inputs and outputs.
- [ ] 2.2 Validate task-group split isolation, label provenance, criterion coverage, and run/evidence references.
- [ ] 2.3 Add fixtures for malformed, mismatched, incomplete, and split-leaking datasets.

## 3. Judge Calibration and Gate

- [ ] 3.1 Implement per-task-group repetition aggregation and deterministic rates/uncertainty intervals.
- [ ] 3.2 Implement holdout qualification by criterion and declared task-class/evidence-shape scope.
- [ ] 3.3 Implement artifact validity, revocation, identity/scope matching, and qualification verification.
- [ ] 3.4 Implement gate outcomes and findings that separate pass/fail/indeterminate from execution mode.
- [ ] 3.5 Add deterministic tests for supported failures, missing evidence, instability, fallback, and eligible enforcement.

## 4. Documentation and Verification

- [ ] 4.1 Document consumer-visible result meaning and v1/v2 compatibility in package READMEs.
- [ ] 4.2 Run `bun run validate` and record exact results.
- [ ] 4.3 Review the final diff for contract scope, dependency direction, and ungrounded failure attribution.
- [ ] 4.4 Complete an independent review against a fixed commit SHA and record findings.
