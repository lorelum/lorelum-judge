# Protocol Rubric Set Specification

## Purpose

Tie a rubric to the task it was written for, record which of the task's acceptance
criteria each criterion covers, and make a compilation report that cannot disagree with the
rubric.

## ADDED Requirements

### Requirement: A task contract names its acceptance criteria

A `TaskContract` MUST have an `id`, a `taskClass`, a `text`, and at least one acceptance
item. Each acceptance item MUST have an `id`, a `text`, and a `source` whose `origin` is
`user`, `policy`, `contract`, or `decision` with a non-empty `ref`. Acceptance ids MUST be
unique. `taskClass` MUST be a non-empty string other than `*`.

#### Scenario: Duplicate acceptance id is rejected

- **WHEN** two acceptance items share an id
- **THEN** validation fails with code `duplicate_acceptance`

#### Scenario: Acceptance item without a source is rejected

- **WHEN** an acceptance item has no `source`
- **THEN** validation fails with code `schema`

#### Scenario: The wildcard is not a task class

- **WHEN** a contract has `taskClass` `*`
- **THEN** validation fails with code `invalid_applicability`

### Requirement: Rubric entries declare coverage, applicability, and role

A `RubricSet` MUST have an `id`, a `status` of `proposal` or `frozen`, a
`contractIdentity`, and at least one entry. Each entry MUST have a `criterion` conforming
to #6's schema, a non-empty unique `covers` list of acceptance ids, a non-empty `appliesTo`
list, and a `role` of `decisive` or `advisory`. `appliesTo` MUST NOT repeat a value, and
`*` MUST appear alone. Criterion ids MUST be unique across the set.

#### Scenario: Mandatory criterion without a source is rejected in both states

- **WHEN** an entry's criterion is mandatory and has no `source`
- **THEN** validation fails in `proposal` and in `frozen`

#### Scenario: Wildcard mixed with a class is rejected

- **WHEN** `appliesTo` is `["*", "cli"]`
- **THEN** validation fails with code `invalid_applicability`

#### Scenario: Duplicate criterion id is rejected

- **WHEN** two entries have the same criterion id
- **THEN** validation fails with code `duplicate_criterion`

### Requirement: A frozen rubric passes the full criterion rules

A `frozen` rubric MUST pass every rule of #6's criterion validation, including anchors that
cover exactly the decisive verdicts and one primary owner per evidence id. A `proposal`
MAY have incomplete anchors.

#### Scenario: Proposal without anchors is accepted, frozen is not

- **WHEN** an entry's criterion has no anchors
- **THEN** the rubric validates as `proposal` and fails as `frozen` with code
  `anchor_mismatch`

#### Scenario: Frozen rubric with two primary owners is rejected

- **WHEN** two criteria in a frozen rubric are primary for the same evidence id
- **THEN** validation fails with code `duplicate_primary_evidence`

### Requirement: A rubric is checked against its contract

`validateRubricAgainstContract` MUST fail with `identity_mismatch` when the rubric's
`contractIdentity` is not the identity of the supplied contract. It MUST fail with
`unknown_acceptance` when an entry covers an id the contract does not have. It MUST fail
with `not_applicable` when an entry's `appliesTo` includes neither the contract's
`taskClass` nor `*`.

#### Scenario: Rubric for another contract is rejected

- **WHEN** the rubric's `contractIdentity` differs from the supplied contract's identity
- **THEN** validation fails with code `identity_mismatch`

#### Scenario: Entry covering an unknown acceptance id is rejected

- **WHEN** an entry's `covers` names an id absent from the contract
- **THEN** validation fails with code `unknown_acceptance`

#### Scenario: Domain-specific entry does not apply to another class

- **WHEN** an entry applies to `web` and the contract's task class is `cli`
- **THEN** validation fails with code `not_applicable`

#### Scenario: Wildcard entry applies to every class

- **WHEN** an entry applies to `*`
- **THEN** it passes the applicability check for any task class

### Requirement: A compilation report agrees with the rubric

A `CompilationReport` MUST have a `contractIdentity` and the lists `covered`, `uncovered`,
`unsupported`, and `merged`. `validateCompilationReport` MUST require that: every
acceptance id of the contract appears in exactly one of `covered`, `uncovered`, and
`unsupported`; an id with covering entries is in `covered` and lists exactly those
criterion ids; an id with none is in `uncovered` or `unsupported` with a non-empty
`reason`; and each `merged` record names a `criterionId` present in the rubric and
`mergedFrom` ids absent from it. A report whose `contractIdentity` differs from the
contract's MUST fail with `identity_mismatch`.

#### Scenario: Report claims coverage nothing provides

- **WHEN** an acceptance id is `covered` but no entry covers it
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Report omits an acceptance id

- **WHEN** an acceptance id is in none of the three lists
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Report lists an id twice

- **WHEN** an acceptance id is in two of the three lists
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Covered with the wrong criterion ids

- **WHEN** `covered` lists criterion ids that differ from the entries covering it
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Merged record naming a surviving id

- **WHEN** a `mergedFrom` id is still present in the rubric
- **THEN** validation fails with code `report_mismatch`

### Requirement: Identities bind what the rubric depends on

`taskContractIdentity` MUST be independent of acceptance order and change with any other
content change. `rubricIdentity(rubric, binding)` MUST validate the rubric against the
contract and the instrument, then be independent of entry order and of the order inside
`covers` and `appliesTo`, and MUST change when the rubric's content or status, the
contract, the context identity, the instrument, or the policy identity changes.

#### Scenario: Reordered acceptance items keep the contract identity

- **WHEN** the same acceptance items are supplied in a different order
- **THEN** the contract identity is equal

#### Scenario: Reordered entries keep the rubric identity

- **WHEN** the same entries are supplied in a different order
- **THEN** the rubric identity is equal

#### Scenario: A change in model, prompt, context, or policy changes the rubric identity

- **WHEN** the instrument's model or prompt identity, the context identity, or the policy
  identity changes
- **THEN** the rubric identity differs

#### Scenario: Proposal and frozen differ

- **WHEN** the same entries are identified as `proposal` and as `frozen`
- **THEN** the identities differ

### Requirement: Validation returns values

Every function in this capability MUST return a result value and MUST NOT throw for invalid
input, including input whose property access throws.

#### Scenario: Hostile input does not throw

- **WHEN** a contract, rubric, or report has a getter that throws
- **THEN** the function returns a failed result carrying the thrown message

### Requirement: Schemas generate types and load in Node ESM

The new schemas MUST be generated into TypeScript types and checked by the repository gate,
and the built entrypoint MUST load them in Node ESM.

#### Scenario: Dist smoke test

- **WHEN** the built entrypoint is imported in Node ESM and given a valid contract, rubric,
  and report
- **THEN** every validator succeeds
