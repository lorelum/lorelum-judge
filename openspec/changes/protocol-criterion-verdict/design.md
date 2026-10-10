## Context

#27 gave `protocol` a content-derived identity. Nothing yet says what a criterion
is. AGENTS.md requires finite verdicts with anchors (4.4), no forged verdicts for
missing evidence (4.3), and a single primary scoring owner per evidence (4.3).

Decisions about schema authority and tooling were made in discussion before this
change: JSON Schema is authoritative, `ajv` validates, types are generated, and
cross-field rules stay hand-written.

## Goals / Non-Goals

**Goals:**

- A criterion always has a finite verdict set and an anchor for every decisive
  verdict.
- A mandatory criterion always has a recorded source.
- A decisive verdict cannot exist without declared evidence.
- Evidence has at most one primary owner across a criterion set.

**Non-Goals:**

- MeasurementDefinition, InstrumentProfile, MeasurementRun (#6c).
- EvidenceBundle, EvidenceItem, evidence status, prompt projection (#7).
- Calibration and gate (#9). No numeric score exists in this change.
- No runtime contract change.

## Decisions

### Verdicts are finite strings per criterion kind

| Kind | Decisive verdicts |
| --- | --- |
| `contract` | `met`, `unmet` |
| `quality` | `strong`, `adequate`, `weak` |
| `comparison` | `better`, `equivalent`, `worse` |

Every kind also allows `unknown` and `insufficient`, which are non-decisive and
may carry no evidence. Why a verdict is non-decisive (no evidence, unavailable,
truncated, contradiction) is defined with evidence status in #7; this change only
fixes that such a verdict cannot be read as pass or fail.

The table lives in code once. The schema validates structure; the table drives
the kind-dependent rules (below). Splitting kind rules between `if/then` in the
schema and code was rejected as two places to keep consistent.

### Anchors cover exactly the decisive verdicts

A criterion's anchors MUST contain one anchor for each decisive verdict of its
kind and no others, with no duplicates. An anchor describes what evidence looks
like at that verdict. This is what makes a verdict meaningful beyond its label.

### Mandatory criteria carry a source

`source` is `{ origin, ref }` with `origin` one of `user`, `policy`, `contract`,
`decision`. It is optional in general and required by a schema `if/then` when
`mandatory` is true. This one rule fits the schema, so the schema owns it.

### Evidence ownership is declared on the criterion

A criterion has `evidence: EvidenceSelector[]`, each `{ evidenceId, role }` with
`role` either `primary` or `reference`. `validateCriteria` rejects a criterion
set in which one `evidenceId` is `primary` for two criteria, and rejects duplicate
criterion ids. References are unrestricted. A criterion with no selectors is
valid and can only yield `unknown` or `insufficient`.

`EvidenceSelector` identifies evidence by id only. #7 adds projection and status
by schema version, not by mutating this shape.

### A verdict may cite only declared evidence

`validateVerdict(criterion, value)` first validates `criterion`; an invalid or
non-object criterion yields issues with code `invalid_criterion` and a path
prefixed `criterion`, never a thrown error. It then rejects a verdict whose
`criterionId` differs, whose verdict is outside the kind's allowed set, whose
decisive verdict has no `evidenceIds`, or that cites an id the criterion did not
declare. The last rule keeps a verdict from borrowing evidence owned elsewhere
without an explicit reference.

### Schemas live under `src/schemas`

AGENTS.md anticipates a top-level `schemas/`; discussion preferred keeping them in
`protocol`. `packages/protocol/schemas/` would sit outside the build `rootDir`
(`./src`), so `tsc` could not emit them. Verified in a scratch build: JSON placed
under `src/` and imported with `with { type: "json" }` is emitted to `dist/` and
loads in Node ESM. Schemas are therefore `packages/protocol/src/schemas/*.schema.json`.

### Generated types are committed and checked

`scripts/generate-protocol-types.ts` writes `src/generated/*.ts` with
`json-schema-to-typescript` (root dev dependency). `--check` regenerates in memory
and fails on any difference. `bun run validate` runs it before typecheck, so a
schema edit without regeneration fails. The generated directory is ignored by
Biome. Generated interfaces are mutable; consumers do not write to them.

### Errors are values owned by protocol

Validation returns `{ ok: true, value }` or `{ ok: false, issues }`, where an issue
is `{ path, code, message }`. Schema failures use the single code `schema`, with
the `ajv` keyword in `message`; keeping `ajv` vocabulary out of `code` stops the
validator from leaking into the public API. Semantic failures use protocol codes
such as `anchor_mismatch`, `duplicate_primary_evidence`, `verdict_not_allowed`,
`verdict_without_evidence`, `evidence_not_declared`, `criterion_mismatch`,
`duplicate_criterion`, `duplicate_evidence`, and `invalid_criterion`. No `ajv`
type is exported. Nothing throws on invalid input.

Every issue path uses one format: `$` for the root, `.name` for properties, and
`[n]` for array indexes, for example `$.anchors[1].verdict`. JSON pointers from
the validator are converted, including `~0` and `~1` escapes.

### Schema identifiers

`schema` is a required constant: `lorelum.judge.criterion/v1` and
`lorelum.judge.verdict/v1`. These are the identifiers later passed to `identityOf`.
A shape change bumps the version.

## Risks / Trade-offs

- [Two layers of validation can drift] -> Schema owns structure and the mandatory
  source rule; code owns only kind-dependent and cross-record rules. Tests cover
  each rule from both sides.
- [`ajv` and the type generator add dependencies] -> `ajv` is a runtime dependency
  of `protocol`; the generator is a root dev dependency only. Both are pinned.
- [Generated types are mutable] -> Accepted; the alternative is post-processing
  generator output.
- [Large integers above 2^53 silently round in `canonicalize`, noted in #27] -> No
  schema here contains an unbounded integer, so the risk is not exercised yet.

## Migration Plan

1. Create issue #30, this change, and a draft PR with OpenSpec artifacts only.
2. Add dependencies, schemas, generator and staleness check.
3. Add validation and tests.
4. Run `bun run validate` and a Node ESM load that validates one criterion and one
   verdict from `dist`.

Rollback removes the new files and dependencies; nothing else depends on them yet.

## Open Questions

None that block this change.
