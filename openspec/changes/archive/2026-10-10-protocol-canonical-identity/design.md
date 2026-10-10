## Context

`AGENTS.md` 4.2 requires that a change to rubric, prompt, model, decoding, or
policy invalidates earlier calibration. The only safe failure direction is
"identical content gets a different identity" (an extra recalibration).
"Different content gets the same identity" is unsafe: stale calibration would
be treated as valid.

Surveyed projects do not provide a reusable answer. DeepEval keys its cache by
`json.dumps` of a sorted dict, OpenAI Evals generates `run_id` from a timestamp
plus random bytes, Braintrust uses a server-side transaction id for dataset
versions, and Pydantic Evals relies on a manually bumped `evaluator_version`
tag. None derives identity from content with strict normalization.

## Goals / Non-Goals

**Goals:**

- Same content gives the same identity regardless of key order.
- Different content gives a different identity.
- Different record types never collide.
- Inputs that serialization would silently change are rejected.

**Non-Goals:**

- Domain types (criterion, verdict, measurement) belong to #6b and #6c.
- JSON Schema, validation libraries, and type generation are deferred until the
  first schemas exist.
- Deciding which fields belong to identity versus provenance is done per type.
- No runtime contract change. Instrument identity is declared by the caller.

## Decisions

### Serialize with `canonicalize` (RFC 8785)

Use the `canonicalize` package, which has no runtime dependencies. Verified in a
throwaway script with `canonicalize@5.1.0`: it orders keys, normalizes `1.0` to
`1`, and throws on `NaN`, `Infinity`, lone surrogates, and `bigint`. It also
silently drops `undefined` fields and rounds integers above 2^53.

### Reject `undefined` before serializing

`{a: undefined}` and `{}` would otherwise share an identity, which is the unsafe
direction. A small guard walks the value and returns a structured error. Other
silent behaviors are not guarded here: integers above 2^53 are bounded by the
schema layer once schemas exist, and Unicode normalization differences only
produce a different identity, which is the safe direction.

### Identity is `sha256:<hex>` over schema id plus content

Hash `{"schema": <id>, "value": <record>}` after canonicalization. The schema id
isolates record types, and a schema version bump changes every identity of that
type. No second version number is kept for the serialization rules; a rules
change is a schema version change.

Use `node:crypto` synchronous `createHash`. Verified on Node 22.21.0 and Bun
1.4.2 to produce identical output. Web Crypto is asynchronous and would make
every identity function `async` with no benefit. `protocol` therefore targets
Node and Bun, not browsers; this is recorded here and can be revisited.

### Errors are values

`identityOf` returns `{ ok: true, identity }` or `{ ok: false, error }`, in line
with AGENTS.md 4.5. It does not throw for invalid input.

### `protocol` dependency wording

`docs/architecture/repository-layout.md` says `protocol -> none`. The layer check
only inspects workspace packages, so an external dependency is not blocked. The
wording is changed to `protocol -> no workspace package` to remove the
ambiguity.

## Risks / Trade-offs

- [The guard may miss a silent rewrite we did not think of] -> Contract tests
  assert that distinct inputs yield distinct identities for the cases listed in
  the spec; new cases are added when found.
- [`canonicalize` behavior may change in a new major version] -> Pin the exact
  version and verify with RFC 8785 test vectors that fall inside the JSON subset
  used here.
- [`node:crypto` excludes browser consumers] -> Accepted for now; the only known
  consumer is a TypeScript repository running on Node.

## Migration Plan

1. Create issue #27, this change, and a draft PR with OpenSpec artifacts only.
2. Add the dependency, JSON type, serializer, guard, and `identityOf`.
3. Add contract tests and update the README and architecture wording.
4. Run `bun run validate` and a Node ESM load of the built entrypoint.

Rollback removes the new source files and the dependency; nothing else depends
on them yet.

## Open Questions

None that block this change.
