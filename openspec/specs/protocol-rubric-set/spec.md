# protocol-rubric-set Specification

## Purpose
Tie a rubric to the task it was written for, record which of the task's acceptance
criteria each criterion covers, and make a compilation report that cannot disagree with the
rubric.

## Requirements

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
MAY omit anchors, but every anchor it has MUST be a verdict its kind allows and MUST NOT
repeat, evidence selectors within a criterion MUST NOT repeat an evidence id, and a
mandatory criterion MUST have a source. A proposal MAY have two criteria that are primary
for the same evidence id; ownership is checked when the rubric is frozen.

#### Scenario: Proposal without anchors is accepted, frozen is not

- **WHEN** an entry's criterion has no anchors
- **THEN** the rubric validates as `proposal` and fails as `frozen` with code
  `anchor_mismatch`

#### Scenario: Proposal with a contradictory anchor is rejected

- **WHEN** a proposal's `contract` criterion has an anchor for `strong`, or two anchors for
  `met`
- **THEN** validation fails with code `anchor_mismatch`

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

A `CompilationReport` MUST have a `contractIdentity` and the lists `covered`, `uncovered`, `unsupported`, `merged`, and `excluded`. `validateCompilationReport` MUST require that: every acceptance id of the contract appears in exactly one of `covered`, `uncovered`, and `unsupported`; an id with covering entries is in `covered` and lists exactly those criterion ids; an id with none is in `uncovered` or `unsupported` with a non-blank `reason`; each `merged` record names a `criterionId` present in the rubric and `mergedFrom` ids absent from it; a criterion id has at most one `merged` record; an absorbed id is not merged into two criteria; and each `excluded` item satisfies the rules in the Excluded requirement below. A `reason` is blank when it has no character other than white space, control characters, format characters, nonspacing and enclosing combining marks, and the fixed glyphs U+115F, U+1160, U+3164, U+FFA0, and U+2800. The list of glyphs is fixed; it is not a complete table of invisible characters, and a reason made only of combining marks is blank. Spacing combining marks (category Mc) are visible and are not blank. A report whose `contractIdentity` differs from the contract's MUST fail with `identity_mismatch`.

`merged` and `excluded` records are supplied by the caller and are NOT verified against the proposals they describe: the validator receives only the rubric and the contract. It checks that the records are coherent with the rubric and with each other, and no more.

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

### Requirement: Input is read once

Every function in `packages/protocol` that takes untrusted input MUST copy that input into plain data once and MUST validate, hash, and return the copy. This covers each validator, each identity function (including `identityOf` and `canonicalForm`), `evaluateEnforcement`, and `measurementKey`, including the evidence list that `measurementKey` receives. `evaluateEnforcement` takes an object of fields; each field MUST be copied, and read once, by the validator or identity function that consumes it, except `gatePolicy`, which `evaluateEnforcement` copies once itself because both the degradation and the identity read it. The copy MUST accept only plain objects (prototype `Object.prototype` or `null`) and plain arrays (prototype `Array.prototype`), MUST read own enumerable string keys and each value exactly once, and MUST NOT call `toJSON`.

The copy MUST reject, as a structured failure naming the path: symbol keys; non-enumerable own properties; string keys that are lone surrogates; extra own properties on arrays; array holes; `undefined` array elements; functions, symbols, bigints, and non-finite numbers; lone-surrogate strings; cycles; `Date`; boxed primitives; class instances; and any input whose reading throws.

An own property whose value is `undefined` MUST be kept in the copy, so that a validator and an identity function see the input as the caller wrote it.

An identity function MUST report the first rejected value in traversal order, with its path and its reason: `undefined`, `not_finite`, `bigint`, or `unsupported`. A node's own structural defects (a symbol key, a non-enumerable property, an extra array property) are reported before any defect in that node's children. The validator-based identity functions run their validator first and report its issues; the reason codes apply to `identityOf` and `canonicalForm` called directly. The path is the location where the copy stopped: a getter that throws is reported at the property it reads, and any other error raised while reading a node is reported at that node.

Properties that exist only on the prototype MUST NOT be validated yet omitted from a hash, and a getter MUST NOT be able to return different data to the validation and to the hash.

#### Scenario: Inherited fields are rejected

- **WHEN** a contract's required fields exist only on its prototype
- **THEN** the function returns a failed result and no identity

#### Scenario: A getter is read once

- **WHEN** a field is a getter that returns a different value on each read
- **THEN** the getter is read exactly once and the identity covers the value that was read

#### Scenario: A value is not converted into another type

- **WHEN** a string field holds a `Date` or a boxed `String`, or the input has a `toJSON` method
- **THEN** validation fails and `toJSON` is not called

#### Scenario: A lone surrogate is invalid everywhere

- **WHEN** a text field contains a lone surrogate
- **THEN** both validation and the identity function fail

#### Scenario: Identity of an untrusted date fails

- **WHEN** `identityOf` is called with a `Date` as the value
- **THEN** it returns a failed result and does not hash the date's string form

#### Scenario: Identity of an untrusted throwing getter fails

- **WHEN** `identityOf` is called with an object whose getter throws
- **THEN** it returns a failed result and does not throw

#### Scenario: An undefined property is not hashed as absent

- **WHEN** a validated record has an own property whose value is `undefined`
- **THEN** its identity fails with reason `undefined`

#### Scenario: A symbol-keyed or hidden property is rejected

- **WHEN** an input has a symbol key, a non-enumerable own property, or a non-enumerable array element
- **THEN** the copy rejects it with a structured failure naming the path

### Requirement: Validation returns values

Every function in this capability MUST return a result value and MUST NOT throw for invalid
input, including input whose property access throws.

#### Scenario: Hostile input does not throw

- **WHEN** a contract, rubric, or report has a getter that throws
- **THEN** the function returns a failed result carrying the thrown message

### Requirement: Schemas generate types and load in Node ESM

The new schemas MUST be generated into TypeScript types and checked by the repository gate,
and the built entrypoint MUST load in Node ESM through the existing dist check.

#### Scenario: Dist import

- **WHEN** `bun run check:dist` imports the built `protocol` entrypoint in Node ESM
- **THEN** the import succeeds

#### Scenario: Behaviour from the built entrypoint

- **WHEN** the built entrypoint is exercised in Node ESM with a valid contract, rubric, and
  report during verification
- **THEN** every validator succeeds; this is recorded as evidence in the PR, not as a
  repository script, because the dist check is shared by every package

### Requirement: Excluded proposals are recorded

Each `excluded` item MUST have a `criterionId`, a `code` of `not_applicable` or `conflict`, and a non-blank `reason`. The `criterionId` values in `excluded` MUST be unique. Ids are compared exactly, with no trimming or case folding, as elsewhere in the rubric: `c1 ` is a different id from `c1`. A report without an `excluded` field MUST fail schema validation.

#### Scenario: A criterion in the rubric cannot also be excluded

- **WHEN** an `excluded` item names a criterion that is in the rubric
- **THEN** validation fails with code `report_mismatch`

#### Scenario: An absorbed proposal cannot also be excluded

- **WHEN** an `excluded` item names an id that appears in a `merged` record's `mergedFrom`
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Repeated excluded id

- **WHEN** two `excluded` items name the same `criterionId`
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Blank reason

- **WHEN** an `excluded` item has a `reason` of only whitespace
- **THEN** validation fails with code `schema`
