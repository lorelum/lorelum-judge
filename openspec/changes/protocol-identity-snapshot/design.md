## Context

`identityOf` predates the copy routine. Its comment says the value is trusted and `snapshot` is applied by callers, but `identityOf` is exported, so the trust boundary is not the package's to assume.

## Decisions

### Copy inside the public identity functions

`identityOf(schema, value)` and `canonicalForm(value)` take `unknown` and call `snapshot`. Callers inside the package already pass snapshots, so copying twice costs time but does not change results. Doing it once in the public function means no exported path can skip the copy.

The copy throws. The identity functions catch it and return `{ ok: false, error }`. The error reason is `unsupported` with the path where the copy stopped, which is what a rejected value is. A thrown getter, lone surrogate, cycle, and depth overflow all map to `unsupported`; the path is the closest location the copy reported, or `$` when it has none.

### Keep undefined-valued properties

Dropping them made the copy disagree with the raw input. Raw ajv treats an `undefined` required property as missing (correct) and an `undefined` extra property as an additional property (reject). The copy dropped both, so an extra `undefined` key validated. Keeping the key lets ajv see exactly what the caller wrote. `identityOf` already rejects `undefined` with reason `undefined`, so a validated record with an `undefined` property now fails identity rather than hashing without it. That is the disagreement the review found, removed in the safe direction.

### Reject what the copy cannot represent

- Symbol keys and non-enumerable own properties: the identity would ignore them while the validator might read them. Rejected.
- Lone-surrogate keys: rejected to match lone-surrogate values.
- Extra own properties on arrays: the canonical form ignores them. Rejected.

### Stack depth

A deep input is rejected by the copy as `Maximum call stack size exceeded`, caught and mapped to `unsupported`. The exact depth limit depends on the engine and is not part of the contract.

## Non-goals

- Changing the identity function (sha256 of RFC 8785 canonical form).
- Rewriting `rubric.ts` duplicate copies (recorded in #42 as deferred).
