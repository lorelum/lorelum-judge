## Why

`protocol` can describe a criterion (#30) and identify any record (#27), but it
cannot yet say what a measurement measured, with which instrument, or whether its
result may be enforced. AGENTS.md 4.2 requires a change to the rubric, prompt,
model, decoding, policy, or evidence to invalidate earlier calibration, and says
that mismatched identity may only run as shadow, diagnostic, or indeterminate.

This change implements the last part of #6, tracked as #32.

## What Changes

- Add `MeasurementDefinition`, `InstrumentProfile`, and `MeasurementRun` schemas
  and validation.
- Add the minimal shapes of `GatePolicy` and `CalibrationArtifact`, bound to the
  identities of the definition, instrument, and gate policy.
- Add `evaluateEnforcement`, which allows enforcement only when the calibration is
  enforced and every identity matches, and otherwise returns the reasons and the
  gate policy's declared degradation.
- Add `measurementKey`, a cache key over definition, instrument, and evidence.
- Move cross-schema references to absolute URNs so `MeasurementDefinition` can
  embed `Criterion`.

## Capabilities

### New Capabilities

- `protocol-measurement-contracts`: measurement definition, instrument profile,
  run record, gate policy and calibration shapes, enforcement decision, and cache
  key.

### Modified Capabilities

None.

## Impact

- `packages/protocol`: schemas, generated types, validation, tests, README.
- `scripts/generate-protocol-types.ts`: resolves cross-schema references.
- `criterion.schema.json` and `verdict.schema.json` change `$id` to a URN. The
  `schema` constant inside records is unchanged, so no identity changes.

No runtime contract changes. No evidence bundle, prompt, calibration statistic,
threshold, or confidence semantics are added.
