# @lorelum/judge-protocol

Owns versioned records that cross process, package, repository, or persistence
boundaries. The package contains canonical primitives and contract schemas only.

It has no workspace package dependency. A small number of external packages are
allowed: `canonicalize` for RFC 8785 serialization and `ajv` for schema
validation. It targets Node and Bun because identity hashing uses `node:crypto`.

## Identity

`identityOf(schema, value)` returns `{ ok: true, identity }` with
`sha256:<hex>` over the canonical form of `{"schema", "value"}`, or
`{ ok: false, error }` for `undefined`, `NaN`, `Infinity`, and `bigint`, with the
path of the offending value. Same content gives the same identity regardless of
key order; the schema identifier keeps record types apart.

## Criterion and verdict

JSON Schemas in `src/schemas` are the authority; TypeScript types in
`src/generated` are generated from them (`bun run generate:protocol`) and
`bun run validate` fails when they are stale.

- A criterion has a kind (`contract`, `quality`, `comparison`), anchors that cover
  exactly its decisive verdicts, and evidence selectors (`primary` or
  `reference`). A mandatory criterion must have a `source`.
- `unknown` and `insufficient` are allowed for every kind and may carry no
  evidence. A decisive verdict must cite evidence the criterion declares.
- `validateCriteria` rejects two criteria that are primary for the same evidence.
- `validateCriterion`, `validateCriteria`, and `validateVerdict` return
  `{ ok: true, value }` or `{ ok: false, issues }` with `{ path, code, message }`;
  they do not throw and expose no validator types.

It does not own model calls, runtime state, filesystem execution, provider SDK
types, or benchmark fixture conventions. Measurement definitions follow in #6c;
evidence bundles and status in #7.
