## Why

The legacy judge scores a criterion with `description + max_points`: no finite
verdict, no anchors, no evidence owner. The same input produced `44/54/38`, and a
missing artifact could be written as zero. AGENTS.md 4.3 and 4.4 require that
missing evidence is never forged into a failure and that a criterion has finite
verdicts and anchors.

This change implements the second part of #6, tracked as #30. It builds on the
identity primitive from #27.

## What Changes

- Add JSON Schemas for `Criterion`, `Anchor`, `EvidenceSelector`, and `Verdict`.
- Generate TypeScript types from the schemas, commit them, and fail `validate`
  when they are stale.
- Add runtime validation with `ajv`. Errors are translated into protocol-owned
  issue values; `ajv` types do not appear in the public API.
- Define the finite verdicts of the `contract`, `quality`, and `comparison`
  criterion kinds, plus the non-decisive `unknown` and `insufficient`.
- Require a source for every mandatory criterion.
- Define evidence ownership: one primary owner per evidence, any number of
  references. A decisive verdict must cite declared evidence.

## Capabilities

### New Capabilities

- `protocol-criterion-verdict`: criterion, anchor, evidence selector, and verdict
  contracts with their validation rules.

### Modified Capabilities

None.

## Impact

- `packages/protocol`: schemas, generated types, validation, tests, manifest.
- Root `package.json` gains one dev dependency for type generation and a
  staleness check in `validate`; `biome.json` ignores the generated directory.
- `bun.lock`.

No measurement definition, instrument profile, evidence bundle, prompt, runtime,
or numeric score is added.
