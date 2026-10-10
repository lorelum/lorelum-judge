# @lorelum/judge-protocol

Owns versioned records that cross process, package, repository, or persistence
boundaries. The package contains canonical primitives and contract schemas only.

It has no workspace package dependency. A small number of external packages are
allowed; today that is `canonicalize` for RFC 8785 serialization. It targets Node
and Bun because identity hashing uses `node:crypto`.

## Identity

`identityOf(schema, value)` returns `{ ok: true, identity }` with
`sha256:<hex>` over the canonical form of `{"schema", "value"}`, or
`{ ok: false, error }` for `undefined`, `NaN`, `Infinity`, and `bigint`, with the
path of the offending value. Same content gives the same identity regardless of
key order; the schema identifier keeps record types apart.

It does not own model calls, runtime state, filesystem execution, provider SDK
types, or benchmark fixture conventions. Domain types follow in #6b and #6c.
