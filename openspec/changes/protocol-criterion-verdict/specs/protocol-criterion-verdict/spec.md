# Protocol Criterion And Verdict Specification

## Purpose

Define criteria with finite verdicts and anchors, and verdicts that cannot be
forged from missing evidence.

## ADDED Requirements

### Requirement: A criterion has finite verdicts and anchors

A criterion MUST have a kind of `contract`, `quality`, or `comparison`. Its
decisive verdicts MUST be `met` and `unmet` for `contract`, `strong`, `adequate`,
and `weak` for `quality`, and `better`, `equivalent`, and `worse` for
`comparison`. Every kind MUST additionally allow `unknown` and `insufficient`.
The anchors of a criterion MUST contain exactly one anchor for each decisive
verdict of its kind.

#### Scenario: Complete anchors are accepted

- **WHEN** a `contract` criterion declares anchors for `met` and `unmet`
- **THEN** validation succeeds

#### Scenario: Missing anchor is rejected

- **WHEN** a `quality` criterion declares anchors for `strong` and `weak` only
- **THEN** validation fails with code `anchor_mismatch`

#### Scenario: Foreign or duplicate anchor is rejected

- **WHEN** a `contract` criterion declares an anchor for `strong`, or two anchors
  for `met`
- **THEN** validation fails with code `anchor_mismatch`

### Requirement: A mandatory criterion records its source

A criterion whose `mandatory` is true MUST have a `source` with an `origin` of
`user`, `policy`, `contract`, or `decision` and a non-empty `ref`.

#### Scenario: Mandatory without source is rejected

- **WHEN** a mandatory criterion has no `source`
- **THEN** validation fails

#### Scenario: Optional criterion needs no source

- **WHEN** a non-mandatory criterion has no `source`
- **THEN** validation succeeds

### Requirement: Missing evidence is not a failure

A verdict of `unknown` or `insufficient` MAY carry no evidence. A decisive verdict
MUST cite at least one evidence id. Validation MUST NOT turn missing evidence into
a decisive verdict.

#### Scenario: Decisive verdict without evidence is rejected

- **WHEN** a verdict of `unmet` has an empty `evidenceIds`
- **THEN** validation fails with code `verdict_without_evidence`

#### Scenario: Non-decisive verdict without evidence is accepted

- **WHEN** a verdict of `unknown` has an empty `evidenceIds`
- **THEN** validation succeeds

### Requirement: Evidence has one primary owner

Across a set of criteria, one evidence id MUST be `primary` for at most one
criterion. Any number of criteria MAY reference it, and criterion ids MUST be
unique.

#### Scenario: Two primary owners are rejected

- **WHEN** two criteria both list the same evidence id with role `primary`
- **THEN** validation fails with code `duplicate_primary_evidence`

#### Scenario: One primary and several references are accepted

- **WHEN** one criterion lists an evidence id as `primary` and two others list it
  as `reference`
- **THEN** validation succeeds

#### Scenario: Duplicate criterion id is rejected

- **WHEN** two criteria share an id
- **THEN** validation fails with code `duplicate_criterion`

### Requirement: A verdict cites only declared evidence

A verdict MUST name the criterion it belongs to, use a verdict allowed for that
criterion's kind, and cite only evidence ids the criterion declares as `primary`
or `reference`.

#### Scenario: Verdict outside the kind is rejected

- **WHEN** a `contract` criterion receives the verdict `strong`
- **THEN** validation fails with code `verdict_not_allowed`

#### Scenario: Undeclared evidence is rejected

- **WHEN** a verdict cites an evidence id the criterion does not declare
- **THEN** validation fails with code `evidence_not_declared`

#### Scenario: Wrong criterion is rejected

- **WHEN** a verdict's `criterionId` differs from the criterion it is validated
  against
- **THEN** validation fails with code `criterion_mismatch`

### Requirement: Validation returns values and exposes no validator types

Validation MUST NOT throw for invalid input. It MUST return `ok: true` with the
value or `ok: false` with issues of the form `{ path, code, message }`. No
third-party validator type MUST appear in the public API.

#### Scenario: Invalid input does not reject

- **WHEN** validation receives a non-object value
- **THEN** it returns `ok: false` and does not throw

### Requirement: Generated types match the schemas

The committed TypeScript types MUST be generated from the JSON Schemas, and the
repository gate MUST fail when they differ from freshly generated output.

#### Scenario: Stale types fail the gate

- **WHEN** a schema changes and the types are not regenerated
- **THEN** `bun run validate` exits non-zero

### Requirement: Built entrypoint validates in Node ESM

The built `protocol` entrypoint MUST load its schemas and validate a criterion in
Node ESM.

#### Scenario: Dist smoke test

- **WHEN** the built entrypoint is imported in Node ESM and given a valid
  criterion
- **THEN** validation succeeds
