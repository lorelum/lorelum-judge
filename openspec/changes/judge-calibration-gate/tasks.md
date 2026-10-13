## 1. OpenSpec

- [x] 1.1 Confirm issue scope and record the agreed defaults, aggregation, and v1 compatibility.
- [x] 1.2 Validate with `openspec validate judge-calibration-gate --type change --strict`.
- [x] 1.3 Create the OpenSpec-first PR before source implementation.

## 2. Protocol

- [ ] 2.1 Add dataset, GatePolicy/v2, report, CalibrationArtifact/v2, and gate-decision schemas and generated types.
- [ ] 2.2 Validate identity bindings, task-group split isolation, case coverage, labels, repetitions, and evidence references.
- [ ] 2.3 Test malformed, incomplete, mismatched, duplicate, and split-leaking inputs.

## 3. Judge

- [ ] 3.1 Implement default policy and task-group repetition aggregation.
- [ ] 3.2 Compute per-scope rates and Wilson 95% intervals; qualify holdout scopes only.
- [ ] 3.3 Recompute reports while loading calibration and reject forged, stale, or out-of-scope status.
- [ ] 3.4 Evaluate pass/fail/indeterminate with evidence-backed findings and deterministic localized summaries.
- [ ] 3.5 Test defaults, custom agreement, error-bound failures, fallbacks, mandatory failure precedence, and missing evidence.

## 4. Delivery

- [ ] 4.1 Document result meanings, policy defaults, and v1/v2 compatibility.
- [ ] 4.2 Run strict OpenSpec validation and `bun run validate`; record exact results.
- [ ] 4.3 Review scope and dependencies; independently review a fixed commit SHA and record findings.
