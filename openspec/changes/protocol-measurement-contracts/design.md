## Context

#27 provides `identityOf`. #30 provides `Criterion` and `Verdict`. This change
composes them into the records that AGENTS.md 4.2 to 4.4 talk about: what was
measured, with which instrument, and whether the result may be enforced.

Decided earlier in discussion: the instrument fields are **declared by the
caller**, the runtime contract is not changed, and a declared value is not a
verified value. A later change may add verified values once a real provider exists.

## Goals / Non-Goals

**Goals:**

- Any change to the definition, instrument, or evidence changes an identity.
- A run cannot be built from a verdict set that silently skips a criterion.
- Enforcement is impossible unless a calibration is enforced and matches.

**Non-Goals:**

- EvidenceBundle, evidence status, PromptSpec (#7). `promptIdentity` is only an
  identity string produced by the caller.
- Calibration statistics, thresholds, confidence, repetition semantics (#9). The
  calibration here carries a status and three identities, nothing else.
- Runtime contract changes. Verified instrument values.

## Decisions

### Identities are computed over validated records

`definitionIdentity(def)`, `instrumentIdentity(profile)`, and
`gatePolicyIdentity(policy)` each validate the record, then call `identityOf` with
the record's own `schema` constant. A record that fails validation yields issues,
never an identity. An invalid record therefore cannot be bound to a calibration.

### MeasurementDefinition embeds Criterion

`{ schema, id, criteria[] }`, `criteria` having at least one item. `$ref` to
`Criterion` needs a stable absolute reference, so every schema `$id` becomes a URN
such as `urn:lorelum:judge:criterion:v1`. A scratch run showed that with the
referenced schema registered, `ajv` strict mode compiles the reference and
`json-schema-to-typescript` inlines the referenced type. The generator resolves the
URN from the local schema directory. The `schema` constant inside records
(`lorelum.judge.criterion/v1`) does not change, so no identity changes.

Beyond the schema, `validateDefinition` validates the criteria as a set with
`validateCriteria`: duplicate ids and duplicate primary evidence are rejected.
Criteria order is part of the identity. Sorting would hide a reordering; a
reordering only costs a recalibration, which is the safe direction.

### InstrumentProfile is declared

Fields: `model { provider, name, version? }`, `decoding { temperature?, topP?,
maxTokens?, seed? }`, `promptIdentity`, `runtime { name, version }`, and
`repetitions`. `promptIdentity` is `sha256:` plus 64 lowercase hex characters.

`temperature` and `topP` are numbers because that is what provider APIs take.
`canonicalize` serializes any finite number deterministically and `identityOf`
rejects non-finite ones, so a float field cannot produce an ambiguous identity.
`maxTokens`, `seed`, and `repetitions` are integers with a maximum of 2^53 - 1;
#27 noted that `canonicalize` rounds larger integers silently, and these bounds
close that for the fields where it could occur.

A model `version` is a declared string. The record does not claim that the
provider served that version.

### MeasurementRun records declared provenance

`{ schema, id, definitionIdentity, instrumentIdentity, instrumentSource,
verdicts[] }`. `instrumentSource` is the constant `"declared"`. A future change
that adds verified values must change this value by bumping the schema version, not
by silently reinterpreting existing records.

`validateRun(definition, instrument, input)` requires that the identities match
the supplied definition and instrument, that every criterion has exactly one
verdict, that no verdict names an unknown criterion, and that every verdict passes
`validateVerdict` against its criterion. A criterion without a verdict is an error,
`missing_verdict`; it is never read as a failure or a zero. If no verdict can be
formed, the caller records `unknown` or `insufficient` explicitly.

A run carries no timestamp, score, or aggregate. Timing and totals are provenance
and belong elsewhere; keeping them out also keeps `MeasurementRun` free of
anything that could be mistaken for a scoring rule owned by #9.

### GatePolicy and CalibrationArtifact are minimal

`GatePolicy` is `{ schema, id, onUncalibrated }` with `onUncalibrated` one of
`diagnostic`, `shadow`, or `indeterminate`. It names how an unenforceable
measurement degrades. Thresholds, confidence, repetition rules, and the failure
taxonomy are #9.

`CalibrationArtifact` is `{ schema, id, definitionIdentity, instrumentIdentity,
gatePolicyIdentity, status }` with `status` one of `diagnostic`, `shadow`,
`provisional`, `enforced`, `expired`, `revoked`. It holds no statistics. #9 extends
it by schema version.

### Enforcement is a pure decision

`evaluateEnforcement({ definition, instrument, gatePolicy, calibration })`
returns `{ enforce: true }` only if all of the following hold, and otherwise
`{ enforce: false, reasons, degradeTo }`:

- a calibration is present, otherwise `no_calibration`;
- `calibration.status` is `enforced`, otherwise `not_enforced`;
- `definitionIdentity` matches, otherwise `definition_mismatch`;
- `instrumentIdentity` matches, otherwise `instrument_mismatch`;
- `gatePolicyIdentity` matches, otherwise `gate_policy_mismatch`.

All applicable reasons are reported, not only the first. `degradeTo` is the gate
policy's `onUncalibrated`. An invalid input record yields `invalid_input` and the
same degradation. The function does not throw. Enforcing never grants any
permission outside measurement; AGENTS.md 4.6 keeps commit, merge, and deploy
decisions out of the judge.

### measurementKey excludes order-insensitive noise

`measurementKey(definition, instrument, evidenceIdentities)` is
`identityOf("lorelum.judge.measurement-key/v1", { definition, instrument,
evidence })` where `evidence` is the sorted, de-duplicated list of identities.
Evidence is a set, so its order must not change the key. Definition and instrument
enter by identity, so any change to either changes the key. Each evidence identity
must match `sha256:` plus 64 lowercase hex characters.

### Schemas keep one source

JSON Schema owns structure, enums, integer bounds, and the identity pattern. Code
owns what a schema cannot say: criteria as a set, identity matching, exactly one
verdict per criterion, and the enforcement decision. The generator
(`scripts/generate-protocol-types.ts`) keeps its stale and orphan checks.

## Risks / Trade-offs

- [`temperature` and `topP` are floats inside an identity] -> Accepted. `canonicalize`
  is deterministic for finite numbers and non-finite values are rejected before
  hashing. Integer scaling was considered and rejected as unnatural for provider
  parameters.
- [A declared instrument can differ from what ran] -> Recorded as `declared`; verified
  values are a later change.
- [Criteria order is identity-bearing] -> Safe direction; a reorder invalidates
  calibration but never reuses it wrongly.
- [Changing `$id` values touches existing schemas] -> Only the URN changes; the
  `schema` constants and therefore every identity stay the same. A test pins an
  identity computed before this change.

## Migration Plan

1. Create #32, this change, and a draft PR with OpenSpec artifacts only.
2. Convert `$id` values, teach the generator to resolve references, and confirm the
   existing generated types are unchanged.
3. Add the new schemas, validation, identities, run validation, enforcement, and
   cache key.
4. Run `bun run validate` and a Node ESM flow from definition to enforcement.

Rollback removes the new files and restores the previous `$id` values.

## Open Questions

None that block this change.
