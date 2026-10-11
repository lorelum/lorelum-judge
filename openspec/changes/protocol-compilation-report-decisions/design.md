## Context

#38 made the report derived and checkable against the frozen rubric and the contract. Exclusions are the one kind of decision the compiler makes that the frozen rubric cannot show, so they need their own list.

## Decisions

### Only two exclusion codes

`not_applicable` means the entry's `appliesTo` does not include the contract's task class. `conflict` means two proposals cover the same acceptance items and the same evidence selectors but differ in evaluation, so the compiler keeps neither (decision: do not merge what is not structurally identical; do not choose silently).

Invalid proposals are not a report item. A proposal that fails validation makes the compile call fail, because its identity is unreliable. This keeps `excluded` to items the caller can act on.

### The report does not carry a conflict graph

A conflict's acceptance items already appear as `uncovered` with a reason, and the two `criterionId`s are in `excluded`. A separate conflict structure would duplicate that and add a second place to keep consistent.

### `complete` is derived

Storing `complete` would let it disagree with the lists it summarises. The validator does not need it and the gate (#9) can compute it from `uncovered` and `unsupported`.

### Verification limits

The validator receives the rubric and the contract, not the proposals. It can check that excluded ids are not in the rubric and not absorbed, and that reasons are non-blank. It cannot check that an excluded entry really fails `appliesTo`. That check belongs to the compiler's tests and to the caller, the same as for `merged`.

## Non-goals

- Compiler behaviour (#8b).
- Repo-context predicates (`appliesWhen`).
