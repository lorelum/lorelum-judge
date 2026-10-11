## Context

#6 defines `Criterion` and #7 defines evidence. A criterion says what to check, but not
which requirement it answers to. This change adds the record that ties criteria to a task's
acceptance criteria, and a report that says which acceptance criteria are covered. #8b will
produce both.

## Goals / Non-Goals

**Goals:** a stable task input; a rubric whose every entry names the acceptance criteria it
covers; a report that cannot disagree with the rubric; an identity that changes when
anything the rubric depends on changes.

**Non-Goals:** deriving criteria from a contract, judging whether two criteria mean the
same thing, calling a model, calibration, gate semantics, and any change to #6 or #7.

## Decisions

### TaskContract is a protocol record

A contract has an `id`, a `taskClass`, the task `text`, and one or more `acceptance`
items, each with an `id`, a `text`, and a `source` using the same origins as `Criterion`
(`user`, `policy`, `contract`, `decision`). `taskClass` is an open string and MUST NOT be
`*`. Acceptance ids are unique. The contract does not carry repository context; context
enters only through the rubric binding.

### Task class is open; applicability is declared by the rubric entry

A rubric entry lists the task classes it applies to, or the single value `*`. A rubric
checked against a contract MUST contain only entries that apply to the contract's task
class. An entry that does not apply is an error, not something to skip, because a rubric
that carries a domain-specific criterion for the wrong class is exactly the old failure.
`*` MUST appear alone and class names MUST NOT repeat.

### A rubric has two states

`proposal` and `frozen`. A proposal may omit anchors, because it is a draft that someone
or something still has to finish, but it may not be contradictory: an anchor must be a
verdict the kind allows, anchors must not repeat, evidence selectors must not repeat an id,
and a mandatory criterion needs a source. Missing anchors are the only leniency, and
primary-evidence ownership is checked when the rubric is frozen. A frozen rubric MUST pass
the full #6 criterion rules, including anchors covering exactly the decisive verdicts and
one primary owner per evidence id. The
transition from proposal to frozen is a validation, not a function in this change; the
compiler that performs it is #8b.

### Each entry covers acceptance criteria and carries a decision role

An entry has a `criterion` (from #6), `covers` (acceptance ids, at least one, unique), an
`appliesTo` list, and a `role` of `decisive` or `advisory`. The role is a declaration
that a later gate may read; this change gives it no gate semantics. Criterion ids are
unique across the set.

### The rubric binds to its contract by identity

A rubric carries the `contractIdentity` it was built for. `validateRubricAgainstContract`
recomputes the contract's identity and fails with `identity_mismatch` if they differ, so
a rubric cannot be used against a task it was not written for. Every id in `covers` MUST
exist in the contract.

### The report is derived, so it can be checked

For a contract and rubric, the covering criteria of an acceptance item are the entries
whose `covers` contains it. A report is valid only if it agrees:

- every acceptance id appears in exactly one of `covered`, `uncovered`, `unsupported`;
- an item with at least one covering entry MUST be in `covered`, listing exactly those
  criterion ids;
- an item with none MUST be in `uncovered` or `unsupported`, with a non-empty reason;
- each `merged` record names a kept criterion that exists in the rubric and one or more
  `mergedFrom` ids that do not exist in it, because they were absorbed.

A report that says "covered" for an item nothing covers, or omits an item, fails. The
report cannot be a free-form claim.

### Merging is structural

This change records merges but does not decide them. #8b merges two proposals only when
their covered acceptance ids and evidence selectors are identical. No semantic similarity
is judged anywhere, matching the earlier decision for evidence.

### Rubric identity binds everything it depends on

`rubricIdentity(rubric, binding)` takes the contract, a `contextIdentity`, the instrument
profile, and a `policyIdentity`. It validates the rubric against the contract and the
instrument, then hashes the normalized rubric together with the contract identity, the
context identity, the instrument identity (which covers model, decoding, prompt identity,
runtime, and repetitions), and the policy identity. Entries are sorted by criterion id and
each entry's `covers` and `appliesTo` are sorted, so order does not change the identity;
status, role, and any criterion content do. `contextIdentity` and `policyIdentity` are
supplied by the caller and are not verified.

### Input is snapshotted once

Validators run on untrusted input, and `ajv` reads inherited properties while `{...value}`
copies only own ones. Validating one view and hashing another lets a contract whose fields
live on its prototype validate and then hash without them, so two different tasks share an
identity. A getter that returns different data on each read has the same effect. Each public
function therefore copies its input once with a JSON round trip (own enumerable properties,
getters read once) and validates, hashes, and returns the copy. Input that cannot round trip,
such as a cycle, a bigint, or a throwing `toJSON`, becomes a structured failure.

### Errors are values

Validators return `{ ok: true, value }` or `{ ok: false, issues }` and never throw, using
the existing `guarded` helper. New issue codes: `invalid_applicability`, `not_applicable`,
`unknown_acceptance`, `duplicate_acceptance`, `report_mismatch`. Existing codes are reused
where they already describe the failure.

## Risks / Trade-offs

- `contextIdentity` and `policyIdentity` are opaque. Two callers can pass unrelated values;
  the library cannot tell. This is disclosed, as for `contentIdentity` in #7a.
- `role` is a declaration without semantics until #9. A consumer must not read it as a
  gate rule.
- Generated types repeat `Criterion` inside `RubricSet`. This is the same cosmetic
  duplication as before.

## Migration Plan

Additive. #6 and #7 schemas and identities are unchanged. Rollback removes the new
schemas, generated files, validators, and tests.

## Open Questions

None that block this change.
