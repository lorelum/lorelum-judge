## ADDED Requirements

### Requirement: Compilation is a deterministic pure function

`compileRubric` MUST return a value and MUST NOT throw. It MUST NOT call a model, read a
file, or read the clock. Invalid input MUST produce `{ ok: false, issues }`.

#### Scenario: Invalid contract is rejected

- **WHEN** the contract fails `validateTaskContract`
- **THEN** the result is `{ ok: false }` with the contract's issues and no report

#### Scenario: Hostile proposal does not throw

- **WHEN** a proposal has a throwing getter or a cycle
- **THEN** the result is `{ ok: false }` naming the proposal path

### Requirement: Applicability follows the task class

A criterion MUST apply when its `appliesTo` contains the contract's `taskClass` or `*`.
A non-applicable proposal MUST be reported as `not_applicable` and MUST NOT enter the rubric.

#### Scenario: Web-only criterion on a CLI task

- **WHEN** a proposal has `appliesTo: ["web"]` and the contract's class is `cli`
- **THEN** the report lists it as `not_applicable` and the rubric omits it

#### Scenario: Wildcard criterion applies to any class

- **WHEN** a proposal has `appliesTo: ["*"]`
- **THEN** it applies to every task class

### Requirement: Mandatory criteria need a source

A mandatory criterion MUST carry a `source` with origin `user`, `policy`, or `contract`.

#### Scenario: Mandatory criterion without source is rejected

- **WHEN** a mandatory proposal has no `source`
- **THEN** compilation fails with a `missing_source` issue at that proposal's path

### Requirement: Freeze requires anchors and completeness

A rubric MUST NOT be frozen while any criterion lacks anchors or while the report is not
complete.

#### Scenario: Proposal without anchors does not freeze

- **WHEN** a criterion has no anchors
- **THEN** `freezeRubric` fails and the rubric stays in the proposal state

#### Scenario: Incomplete report does not freeze

- **WHEN** an acceptance id is uncovered
- **THEN** `freezeRubric` fails and lists the uncovered id

### Requirement: Merge is declared, not inferred

Two criteria MUST merge only when a proposal names the surviving id in `mergedFrom`.
Undeclared overlap of covered acceptance ids MUST be reported as a conflict.

#### Scenario: Declared merge is recorded

- **WHEN** criterion `c7` names `mergedFrom: ["c3"]`
- **THEN** the report lists `c3` as merged into `c7`

#### Scenario: Undeclared overlap is a conflict

- **WHEN** two criteria cover the same acceptance id and neither declares a merge
- **THEN** the report lists a conflict and `complete` is false

### Requirement: Report derivation

The report MUST list covered, uncovered, merged, not_applicable, unsupported, and conflict
entries, and MUST derive `complete` only from them.

#### Scenario: Complete report

- **WHEN** every mandatory acceptance id is covered, no conflicts exist, and none are unsupported
- **THEN** `complete` is true

### Requirement: Identity is bound through protocol functions

The compiler MUST compute rubric and contract identity with `rubricIdentity` and
`taskContractIdentity` and MUST NOT implement its own hashing or copying.

#### Scenario: Identity changes with the contract

- **WHEN** the contract text changes
- **THEN** the rubric identity changes
