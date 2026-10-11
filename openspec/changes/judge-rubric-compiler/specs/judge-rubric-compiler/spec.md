## ADDED Requirements

### Requirement: The model is told the task class and the matching rule

The system message MUST name the contract's exact `taskClass`, written as a JSON string with
every non-ASCII code unit escaped as `\uXXXX`, and MUST state that `appliesTo` must list that
class exactly, or `*`, and that matching is exact and case-sensitive. Because the escaped text
is pure ASCII, NFC normalization of the system message cannot change it. Two contracts that
differ only in `taskClass` MUST produce different system messages.

#### Scenario: Custom task class is named to the model

- **WHEN** the contract's `taskClass` is `internal-cli-v2`
- **THEN** the system message contains `"internal-cli-v2"` and the exact-match rule

#### Scenario: Hostile task class is inert

- **WHEN** the `taskClass` contains quotes or newlines
- **THEN** it appears only as a JSON string literal in the system message

#### Scenario: Non-NFC task class round-trips

- **WHEN** the `taskClass` is not in NFC form (for example `cafe\u0301-cli`)
- **THEN** a model that echoes the class from the final system message produces an `appliesTo`
  that matches the contract exactly, and the rubric compiles

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

Two proposals MUST merge only when a proposal names the surviving id in `mergedFrom`. The
surviving criterion's description, kind, anchors, role, and evidence are the ones kept. The
absorbed criteria's content is discarded, and the report records only their ids. The absorbed
criteria's acceptance ids transfer to the survivor, which MUST select evidence for each of them.

A conflict follows #41: two proposals that cover the same acceptance ids and select the same
evidence (ids and roles), without a declared merge, MUST both be excluded with code
`conflict`. Identical duplicates fall under the same rule; they are reported, never merged
silently. Partial overlap, where the covered ids or the evidence differ, is not a conflict.
A second primary owner of one evidence across kept criteria is a `gate` failure.

#### Scenario: Declared merge

- **WHEN** proposal `c7` names `mergedFrom: ["c3"]`
- **THEN** the report lists `c3` as merged into `c7`, and `c3`'s description and anchors are not in the rubric

#### Scenario: Same covers and evidence without a merge

- **WHEN** two proposals cover `a1` and select evidence `a1` as primary, and neither declares a merge
- **THEN** both are excluded with code `conflict` and `complete` is false

#### Scenario: Partial overlap is kept

- **WHEN** `c1` covers `a1` and `c2` covers `a1` and `a2`, with different evidence
- **THEN** both are kept, and `a1` is covered by both

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

The compiler MUST require a caller-supplied `contextIdentity` and `policyIdentity`, each a
`sha256:` identity, and MUST check their form before the model is called. It MUST NOT
select, render, or read repo context. The identities are bound, not verified.

#### Scenario: Context identity is bound

- **WHEN** a caller supplies a valid `contextIdentity`
- **THEN** it is bound into the rubric identity and not verified

#### Scenario: Malformed identity fails before the model call

- **WHEN** `contextIdentity` is not a `sha256:` identity
- **THEN** compilation fails with category `gate` and the model is not called

### Requirement: Evidence references are consistent

Every evidence selector MUST name an acceptance id. Every covered acceptance id MUST appear
in the entry's own evidence selectors. Two criteria in the rubric MUST NOT both be primary
owners of the same evidence.

#### Scenario: Unknown evidence selector

- **WHEN** a criterion selects evidence `zz` that is not an acceptance id
- **THEN** compilation fails with category `gate` code `unknown_evidence`

#### Scenario: Covered id without evidence

- **WHEN** a criterion covers `a1` but selects no evidence for `a1`
- **THEN** compilation fails with category `gate` code `covers_without_evidence`

#### Scenario: Duplicate primary owner

- **WHEN** two criteria in the rubric are primary for the same evidence
- **THEN** compilation fails with category `gate` code `duplicate_primary_evidence`

### Requirement: Mandatory status survives merge

A mandatory criterion MUST NOT be merged into a criterion that is not mandatory.

#### Scenario: Mandatory member into non-mandatory survivor

- **WHEN** a mandatory criterion is named in `mergedFrom` of a non-mandatory criterion
- **THEN** compilation fails with category `gate` code `merge_drops_mandatory`

### Requirement: Response reads and aborts are classified

A response whose fields cannot be read MUST be an `output` failure. An abort during the
model call MUST be a `model` failure.

#### Scenario: Unreadable response

- **WHEN** reading the response throws
- **THEN** compilation fails with category `output` code `unreadable`

#### Scenario: Abort during the call

- **WHEN** the signal aborts while `generate` is running
- **THEN** compilation fails with category `model` code `aborted`

### Requirement: Freezing re-checks the report

`freezeRubric` MUST accept only a result returned by `compileRubric`, and MUST validate the
report against the rubric and contract that result is bound to. Compiled results MUST be deep-frozen.

#### Scenario: Compiled result cannot be changed

- **WHEN** a caller assigns to a field of a result returned by `compileRubric`
- **THEN** the assignment fails, because the result is deep-frozen
- **AND** `freezeRubric` refuses any object that `compileRubric` did not return, with code `not_compiled`

### Requirement: Empty results keep their reasons

When no criterion remains in the rubric, the compilation MUST fail with `empty_rubric` and
MUST also report each excluded criterion and each declared unsupported acceptance as issues.

#### Scenario: All acceptance unsupported

- **WHEN** the model declares every acceptance unsupported and proposes no applicable criterion
- **THEN** the failure lists `empty_rubric` and one issue per unsupported acceptance with its reason
