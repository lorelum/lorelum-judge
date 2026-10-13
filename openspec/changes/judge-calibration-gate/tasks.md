## 1. OpenSpec

- [x] 1.1 Confirm issue scope and record the agreed defaults, aggregation, and v1 compatibility.
- [x] 1.2 Validate with `openspec validate judge-calibration-gate --type change --strict`.
- [x] 1.3 Create the OpenSpec-first PR before source implementation.

## 2. Protocol

- [x] 2.1 Add dataset, GatePolicy/v2, report, CalibrationArtifact/v2, and gate-decision schemas and generated types.
- [x] 2.2 Validate identity bindings, task-group split isolation, case coverage, labels, repetitions, and evidence references.
- [x] 2.3 Test malformed, incomplete, mismatched, duplicate, and split-leaking inputs.

## 3. Judge

- [x] 3.1 Implement default policy and task-group repetition aggregation.
- [x] 3.2 Compute per-scope rates and Wilson intervals; qualify holdout scopes only.
- [x] 3.3 Recompute reports while loading calibration and reject forged, stale, or out-of-scope status.
- [x] 3.4 Evaluate pass/fail/indeterminate with evidence-backed findings and deterministic localized summaries.
- [x] 3.5 Test defaults, custom agreement, error-bound failures, fallbacks, mandatory failure precedence, and missing evidence.

## 4. Delivery

- [x] 4.1 Document result meanings, policy defaults, and v1/v2 compatibility.
- [x] 4.2 Run strict OpenSpec validation and `bun run validate`; record exact results.
- [x] 4.3 Review scope and dependencies; independently review a fixed commit SHA and record findings.

## Verification Record

- `bun install --frozen-lockfile`: passed; checked 38 installs across 61 packages with no dependency or lockfile changes.
- `openspec validate judge-calibration-gate --type change --strict`: valid.
- `bun run validate`: passed; 606 tests, all five package builds, and Node ESM loading for all five package exports succeeded.
- GitHub Actions `validate` and `git diff --check origin/main...HEAD`: passed for implementation commit `680cba50dd0131f5c34efecc3677cd551cad85fe`.
- Independent read-only reviews ran in isolated contexts. Findings against `0190eda`, `1abfccc`, `76766ae`, `edaf005`, `5a75598`, and `01cefa0` were addressed in subsequent commits. Final review against base `9ca63ba64ce05f2ec3d82011051efaf72f2f1753` at `680cba50dd0131f5c34efecc3677cd551cad85fe` returned no actionable findings.
