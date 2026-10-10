## 1. Issue, OpenSpec, and Initial PR

- [ ] 1.1 Confirm issue #32 owns only measurement definition, instrument, run,
  minimal gate and calibration shapes, enforcement, and cache key.
- [ ] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [ ] 1.3 Validate the change with OpenSpec strict validation.
- [ ] 1.4 Create the change PR with OpenSpec artifacts before implementation
  and continue implementation on the same branch.

## 2. Schema References

- [ ] 2.1 Record an identity computed with the current code as a fixture so a
  later change to it is detected.
- [ ] 2.2 Convert the `$id` of `criterion` and `verdict` to URNs.
- [ ] 2.3 Teach `scripts/generate-protocol-types.ts` to resolve references between
  local schemas, and confirm the existing generated types are unchanged.
- [ ] 2.4 Register the referenced schemas with the validator.

## 3. Schemas and Generated Types

- [ ] 3.1 Add the `MeasurementDefinition`, `InstrumentProfile`, `GatePolicy`,
  `CalibrationArtifact`, and `MeasurementRun` schemas.
- [ ] 3.2 Generate and commit the types.

## 4. Validation and Decisions

- [ ] 4.1 Add validation and identity functions for definition, instrument, and
  gate policy.
- [ ] 4.2 Add `validateRun`.
- [ ] 4.3 Add `validateCalibration` and `evaluateEnforcement`.
- [ ] 4.4 Add `measurementKey`.
- [ ] 4.5 Export the public API without third-party validator types.

## 5. Tests

- [ ] 5.1 Cover each requirement scenario, accepted and rejected.
- [ ] 5.2 Cover identity sensitivity field by field for definition and instrument.
- [ ] 5.3 Cover that an identity computed before this change is unchanged.
- [ ] 5.4 Cover invalid input never throwing across all new functions.

## 6. Documentation

- [ ] 6.1 Update the `protocol` README.

## 7. Verification and Review

- [ ] 7.1 Run `bun install --frozen-lockfile`.
- [ ] 7.2 Run `bun run validate`.
- [ ] 7.3 Run `openspec validate protocol-measurement-contracts --type change --strict`.
- [ ] 7.4 Import the built entrypoint in Node ESM and run definition, instrument,
  run, calibration, and enforcement in sequence.
- [ ] 7.5 Read back the PR and record AI review findings and resolution.

## 8. Final Gate

- [ ] 8.1 Update the PR body with commands, results, deferred work, and
  verification evidence.
- [ ] 8.2 Confirm every acceptance criterion in #32 has evidence.
