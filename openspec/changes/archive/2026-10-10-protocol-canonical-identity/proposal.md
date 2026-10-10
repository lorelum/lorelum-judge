## Why

A measurement identity must answer whether two measurements used the same
definition, instrument, and evidence. Calibration invalidation (AGENTS.md 4.2)
only works if identical content always produces the same identity and different
content never does. No package owns that primitive yet: `protocol` is an empty
entrypoint.

This change implements the first part of #6, tracked as #27.

## What Changes

- Add a JSON value type to `protocol`.
- Add canonical serialization based on RFC 8785.
- Add `identityOf`, which returns `sha256:<hex>` over the canonical form of a
  record together with its schema identifier.
- Reject inputs that serialization would silently rewrite or drop, and return a
  structured error instead of throwing.
- Clarify in the architecture docs that `protocol` has no workspace package
  dependency and may use a small number of external dependencies.

## Capabilities

### New Capabilities

- `protocol-canonical-identity`: canonical serialization and stable identity for
  structured records.

### Modified Capabilities

None.

## Impact

- `packages/protocol` source, manifest, tests, README.
- `docs/architecture/repository-layout.md` wording for the `protocol` edge.
- `bun.lock` for one new external dependency.

No criterion, verdict, measurement, runtime, or provider type is added. Which
fields of a future record take part in identity is decided with that record.
