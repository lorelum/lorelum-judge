## ADDED Requirements

### Requirement: Acceptance criteria are rendered as evidence

The compiler MUST render each acceptance item of the task contract as an evidence item
with its acceptance id, through `compilePrompt`. Model `covers` references MUST use these
ids.

#### Scenario: Acceptance ids are evidence ids

- **WHEN** a contract has acceptance ids `a1` and `a2`
- **THEN** the rendered prompt contains evidence items `a1` and `a2` and no other source of
  acceptance text

#### Scenario: Acceptance text is data

- **WHEN** an acceptance item contains `</evidence>` or an instruction to ignore prior rules
- **THEN** the candidate marker is escaped and the prompt keeps the data notice

### Requirement: Truncated or unrenderable contracts fail

If any acceptance item is truncated, withheld, or cannot be rendered, compilation MUST fail
with category `prompt` and MUST NOT call the model.

#### Scenario: Acceptance text over budget

- **WHEN** the acceptance text exceeds the evidence budget
- **THEN** compilation fails with category `prompt` and the model port is not called

### Requirement: Single structured model call

The compiler MUST call the caller-supplied `ModelPort.generate` once per contract and
MUST require a `structured` response. The compiler MUST pass `runId`, `stepIndex`, and
`signal` from the caller unchanged.

#### Scenario: Message response is rejected

- **WHEN** the model returns `kind: "message"`
- **THEN** compilation fails with category `output` and no report is produced

#### Scenario: Model error

- **WHEN** `generate` throws or the signal aborts
- **THEN** compilation fails with category `model` and does not throw

#### Scenario: Rule budget exceeded

- **WHEN** the rendered rules exceed `ruleBudget`
- **THEN** compilation fails with `rules_over_budget` in category `prompt`

### Requirement: Model output is validated and never repaired

Each proposed criterion MUST pass `validateCriterionDraft`. Any failure MUST fail the
whole compilation with category `output` and a path. The compiler MUST NOT fix fields or
drop entries.

#### Scenario: Malformed proposal

- **WHEN** one proposal lacks anchors required by its kind
- **THEN** compilation fails with category `output` naming that proposal's path

#### Scenario: Hostile output does not throw

- **WHEN** the model response contains a throwing getter or a cycle
- **THEN** compilation fails with category `output` and does not throw

### Requirement: Unknown acceptance ids fail the compilation

A `covers` entry that names an acceptance id not in the contract MUST fail the whole
compilation with category `gate`.

#### Scenario: Covers names a missing id

- **WHEN** a proposal covers `a9` and the contract has no `a9`
- **THEN** compilation fails with category `gate` at that covers path

### Requirement: Applicability follows the task class

A criterion MUST apply when its `appliesTo` contains the contract's task class or `*`.
A non-applicable proposal MUST be reported as `not_applicable`, keep its original
`appliesTo`, and MUST NOT enter the rubric.

#### Scenario: Web-only criterion on a CLI task

- **WHEN** a proposal has `appliesTo: ["web"]` and the contract's class is `cli`
- **THEN** the report lists it as `not_applicable` and the rubric omits it

#### Scenario: Wildcard applies to any class

- **WHEN** a proposal has `appliesTo: ["*"]`
- **THEN** it applies to every task class, and its `appliesTo` is shown unchanged in the
  report

### Requirement: Mandatory criteria need a source

A mandatory proposal MUST carry a `source` with origin `user`, `policy`, or `contract`.

#### Scenario: Mandatory criterion without source

- **WHEN** a mandatory proposal has no `source`
- **THEN** compilation fails with category `gate` at that proposal's path

### Requirement: Merge is declared, not inferred

Two proposals MUST merge only when a proposal names the surviving id in `mergedFrom`.
Undeclared overlap of covered acceptance ids MUST be reported as a conflict.

#### Scenario: Declared merge

- **WHEN** proposal `c7` names `mergedFrom: ["c3"]`
- **THEN** the report lists `c3` as merged into `c7`

#### Scenario: Undeclared overlap

- **WHEN** two proposals cover the same acceptance id and neither declares a merge
- **THEN** the report lists a conflict and `complete` is false

### Requirement: Report derivation

The report MUST list covered, uncovered, merged, not_applicable, unsupported, and conflict
entries, and MUST derive `complete` only from them.

#### Scenario: Complete report

- **WHEN** every mandatory acceptance id is covered and there are no conflicts or
  unsupported items
- **THEN** `complete` is true

### Requirement: Freeze requires completeness and anchors

`freezeRubric` MUST refuse while the report is not complete or any criterion lacks
anchors. It MUST NOT require a review record.

#### Scenario: Incomplete report does not freeze

- **WHEN** an acceptance id is uncovered
- **THEN** `freezeRubric` fails and lists the uncovered id

#### Scenario: Proposal without anchors does not freeze

- **WHEN** a criterion has no anchors
- **THEN** `freezeRubric` fails and the rubric stays in the proposal state

### Requirement: Identity is bound through protocol functions

The compiler MUST compute contract and rubric identity with `taskContractIdentity` and
`rubricIdentity`, binding the instrument (model, decoding, prompt identity, runtime,
repetitions) and the policy. It MUST NOT implement its own hashing or copying.

#### Scenario: Model change changes rubric identity

- **WHEN** the same contract is compiled with a different model identity
- **THEN** the rubric identity changes

### Requirement: Repo context is deferred

The compiler MUST accept only an optional caller-supplied `contextIdentity` and MUST NOT
select, render, or read repo context.

#### Scenario: Context identity is passed through

- **WHEN** a caller supplies `contextIdentity`
- **THEN** it is bound into the rubric identity and not verified
