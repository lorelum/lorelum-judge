# Judge Calibration and Gate

## Why

Measurement records and rubric/evidence validation exist, but a caller cannot tell whether a judge is reliable for a declared scope or distinguish a supported quality failure from missing evidence and an inconclusive review.

## What Changes

- Add a labeled, task-grouped calibration dataset and a versioned gate policy with explicit thresholds and verdict aggregation.
- Produce a held-out report with coverage, false-accept/false-reject, abstention, disagreement, and Wilson intervals.
- Verify calibration provenance and identity before enforcement; otherwise return an advisory result.
- Return a deterministic, user-readable pass/fail/indeterminate summary with findings, evidence, and next steps.

## Scope

Consume caller-supplied cases and measurement runs. Do not add benchmark fixtures, provider execution, legacy migration, workflow delivery permissions, or cross-rubric reuse. A new rubric is advisory until separately calibrated.

## Dependencies

Issue #9; measurement, evidence, and rubric contracts from #6, #7, and #8.
