# Protocol Measurement Contracts Specification

## Purpose

Define what a measurement measured, which declared instrument produced it, and
whether its result may be enforced.

## ADDED Requirements

### Requirement: A definition and an instrument have a content identity

A `MeasurementDefinition` MUST have an id and at least one criterion, and its
criteria MUST pass criterion-set validation. An `InstrumentProfile` MUST declare a
model, decoding, a prompt identity, a runtime, and a repetition count. Each MUST
yield an identity from `identityOf` over its own schema identifier. A record that
fails validation MUST NOT yield an identity.

#### Scenario: Any definition change changes the identity

- **WHEN** a criterion description, anchor, evidence selector, or mandatory flag
  changes, or a criterion is added, removed, or reordered
- **THEN** the definition identity differs

#### Scenario: Any instrument change changes the identity

- **WHEN** the model provider, name, or version, a decoding parameter, the prompt
  identity, the runtime name or version, or the repetition count changes
- **THEN** the instrument identity differs

#### Scenario: Invalid record yields no identity

- **WHEN** a definition has no criteria, or an instrument has a prompt identity
  that is not `sha256:` plus 64 lowercase hex characters
- **THEN** the identity function returns issues and no identity

#### Scenario: Large integers are bounded

- **WHEN** `seed`, `maxTokens`, or `repetitions` exceeds 2^53 - 1, or `repetitions`
  is below 1
- **THEN** validation fails

### Requirement: Instrument values are declared, not verified

A `MeasurementRun` MUST record `instrumentSource` as `"declared"`. The runtime
contract MUST NOT change in this capability.

#### Scenario: Other source is rejected

- **WHEN** a run has an `instrumentSource` other than `"declared"`
- **THEN** validation fails

### Requirement: A run covers every criterion exactly once

A `MeasurementRun` MUST reference the identity of its definition and instrument,
and these MUST equal the identities of the definition and instrument it is
validated against. It MUST contain exactly one verdict for each criterion of the
definition, and every verdict MUST pass verdict validation against its criterion.
A criterion with no verdict MUST be reported as `missing_verdict` and MUST NOT be
treated as a failure or a zero.

#### Scenario: Complete run is accepted

- **WHEN** a run has one valid verdict for each criterion and matching identities
- **THEN** validation succeeds

#### Scenario: Missing verdict is rejected

- **WHEN** a criterion of the definition has no verdict in the run
- **THEN** validation fails with code `missing_verdict`

#### Scenario: Duplicate verdict is rejected

- **WHEN** two verdicts name the same criterion
- **THEN** validation fails with code `duplicate_verdict`

#### Scenario: Unknown criterion is rejected

- **WHEN** a verdict names a criterion that is not in the definition
- **THEN** validation fails with code `unknown_criterion`

#### Scenario: Identity mismatch is rejected

- **WHEN** the run's definition or instrument identity differs from the supplied
  definition or instrument
- **THEN** validation fails with code `identity_mismatch`

#### Scenario: Invalid verdict is rejected

- **WHEN** a verdict is decisive and cites no evidence
- **THEN** validation fails with the verdict issue, reported under the verdict's
  path

### Requirement: Enforcement requires an enforced, matching calibration

`evaluateEnforcement` MUST return `enforce: true` only when a calibration is
present, its status is `enforced`, and its definition, instrument, and gate policy
identities equal those of the supplied records. Otherwise it MUST return
`enforce: false` with every applicable reason and `degradeTo` equal to the gate
policy's `onUncalibrated`. It MUST NOT throw.

#### Scenario: Enforced and matching

- **WHEN** the calibration status is `enforced` and all three identities match
- **THEN** the result is `enforce: true`

#### Scenario: No calibration

- **WHEN** no calibration is supplied
- **THEN** the result is `enforce: false` with reason `no_calibration` and the gate
  policy's degradation

#### Scenario: Status is not enforced

- **WHEN** the calibration status is any of `diagnostic`, `shadow`, `provisional`,
  `expired`, or `revoked`
- **THEN** the result is `enforce: false` with reason `not_enforced`

#### Scenario: Each identity mismatch blocks enforcement

- **WHEN** the definition, instrument, or gate policy changed after calibration
- **THEN** the result is `enforce: false` with `definition_mismatch`,
  `instrument_mismatch`, or `gate_policy_mismatch` respectively

#### Scenario: All reasons are reported

- **WHEN** both the definition and the instrument differ from the calibration
- **THEN** both reasons are returned

#### Scenario: Invalid input does not throw

- **WHEN** a supplied record is not valid
- **THEN** the result is `enforce: false` with reason `invalid_input`

### Requirement: Gate policy and calibration are minimal shapes

A `GatePolicy` MUST declare `onUncalibrated` as `diagnostic`, `shadow`, or
`indeterminate`. A `CalibrationArtifact` MUST declare a status of `diagnostic`,
`shadow`, `provisional`, `enforced`, `expired`, or `revoked`, and the identities of
the definition, instrument, and gate policy. Neither MUST carry thresholds,
statistics, or confidence rules in this capability.

#### Scenario: Unknown status is rejected

- **WHEN** a calibration status is not one of the six
- **THEN** validation fails

### Requirement: The cache key follows definition, instrument, and evidence

`measurementKey` MUST depend on the definition identity, the instrument identity,
and the set of evidence identities. Evidence order and duplicates MUST NOT change
the key.

#### Scenario: Definition, instrument, or evidence change changes the key

- **WHEN** the definition, the instrument, or one evidence identity changes
- **THEN** the key differs

#### Scenario: Evidence order does not matter

- **WHEN** the same evidence identities are supplied in a different order, with or
  without duplicates
- **THEN** the key is equal

#### Scenario: Malformed evidence identity is rejected

- **WHEN** an evidence identity is not `sha256:` plus 64 lowercase hex characters
- **THEN** the function returns issues and no key

### Requirement: Validation returns values

Every validation and identity function in this capability MUST return a result
value and MUST NOT throw for invalid input, using the issue form `{ path, code,
message }`.

#### Scenario: Non-object input

- **WHEN** any function receives `null`, a number, or an array where an object is
  expected
- **THEN** it returns issues and does not throw

### Requirement: Referenced schemas resolve and generated types stay current

Schemas MUST be able to reference one another. Adding this capability MUST NOT
change the identity of any previously valid record, and generated types MUST match
the schemas.

#### Scenario: Earlier identities are stable

- **WHEN** the identity of a criterion fixture computed before this capability is
  recomputed
- **THEN** it is unchanged

#### Scenario: Built entrypoint completes the flow

- **WHEN** the built entrypoint is imported in Node ESM and a definition, instrument,
  run, calibration, and enforcement decision are produced in sequence
- **THEN** every step returns a result and the final decision is consistent with the
  calibration status
