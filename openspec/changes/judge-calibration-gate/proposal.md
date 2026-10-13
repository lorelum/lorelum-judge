# Judge Calibration and Gate

## Why

The protocol can validate a measurement run and whether a legacy calibration identity matches, but it cannot show whether the judge is reliable for a declared task scope. Callers also need a clear distinction between a quality failure and a result that cannot be decided from the available evidence.

## What Changes

- Add versioned contracts for labeled calibration datasets, frozen policies, reports, qualification artifacts, and gate decisions.
- Compute per-criterion, task-class, and evidence-shape error and abstention metrics from held-out task groups, with uncertainty intervals and repeat-disagreement reporting.
- Permit enforcement only when the supplied calibration is eligible, current, and identity/scope matched; otherwise return an advisory or indeterminate decision with actionable reason data.

## Scope

This change consumes caller-provided labels, runs, and evidence references. It does not own benchmark fixtures, execute providers, migrate legacy adapters, or authorize workflow delivery actions. It does not claim generalization beyond validated scopes. Model self-reported confidence is not used as a probability or gate input.

## Dependencies

Issue #9; measurement, evidence, and rubric contracts from #6, #7, and #8.
