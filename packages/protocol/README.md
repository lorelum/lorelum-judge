# @lorelum/judge-protocol

Owns versioned records that cross process, package, repository, or persistence
boundaries. The package contains canonical primitives and contract schemas only.

It has no workspace package dependency. A small number of external packages are
allowed: `canonicalize` for RFC 8785 serialization and `ajv` for schema
validation. It targets Node and Bun because identity hashing uses `node:crypto`.

## Identity

`identityOf(schema, value)` returns `{ ok: true, identity }` with
`sha256:<hex>` over the canonical form of `{"schema", "value"}`, or
`{ ok: false, error }` for a rejected input, with the path and reason of the first
rejected value in traversal order (see the input rule below). A node's own structural
  defects (symbol keys, hidden properties, extra array properties) come before its children. Same content gives the same identity regardless of
key order; the schema identifier keeps record types apart.

## Criterion and verdict

JSON Schemas in `src/schemas` are the authority; TypeScript types in
`src/generated` are generated from them (`bun run generate:protocol`) and
`bun run validate` fails when they are stale.

- A criterion has a kind (`contract`, `quality`, `comparison`), anchors that cover
  exactly its decisive verdicts, and evidence selectors (`primary` or
  `reference`). A mandatory criterion must have a `source`.
- `unknown` and `insufficient` are allowed for every kind and may carry no
  evidence. A decisive verdict must cite evidence the criterion declares.
- `validateCriteria` rejects two criteria that are primary for the same evidence.
  Within one criterion an evidence id is declared at most once.
- `validateCriterion`, `validateCriteria`, and `validateVerdict` return
  `{ ok: true, value }` or `{ ok: false, issues }` with `{ path, code, message }`;
  they do not throw and expose no validator types. Paths use one format, for
  example `$.anchors[1].verdict`. `validateVerdict` validates its criterion first
  and reports problems with it as `invalid_criterion`.

## Measurement

- `MeasurementDefinition` is a set of criteria. `InstrumentProfile` declares the
  model, decoding, prompt identity, runtime, and repetition count that produced a
  measurement. **Instrument values are declared by the caller, not verified**:
  the runtime contract does not report them, and a `MeasurementRun` records
  `instrumentSource: "declared"`.
- `definitionIdentity`, `instrumentIdentity`, and `gatePolicyIdentity` return an
  identity only for a valid record. Changing any field changes the identity.
  Criteria order is part of a definition's identity.
- `validateRun(definition, instrument, run)` requires the run's identities to
  match, and exactly one verdict per criterion. A criterion without a verdict is
  `missing_verdict`; record `unknown` or `insufficient` explicitly instead. A run
  carries no score or timestamp.
- `GatePolicy` and `CalibrationArtifact` are minimal shapes: a degradation
  (`diagnostic`, `shadow`, `indeterminate`) and a status plus three identities.
  Thresholds, statistics, and confidence rules are not defined here.
- `evaluateEnforcement({ definition, instrument, gatePolicy, calibration })`
  allows enforcement only for an `enforced` calibration whose definition,
  instrument, and gate policy identities all match. Otherwise it returns every
  applicable reason and the policy's degradation.
- `measurementKey(definition, instrument, evidenceIdentities)` is a cache key.
  Evidence order and duplicates do not change it.

## Evidence

- An `EvidenceBundle` records what evidence existed and what the judge was shown of
  it. Each item has a `status` (`present`, `no_evidence`, `unavailable`,
  `contradiction`). `present` and `contradiction` items also carry a
  `contentIdentity` and a `render` state (`rendered`, `withheld`, `truncated`) with
  `originalLength` and `renderedLength`, in Unicode code points. Truncation is recorded, never
  implied. Missing evidence is a status, not an error and not a score.
- A `contradiction` names the items it conflicts with, all in the same bundle.
- `validateVerdictEvidence(criterion, verdict, bundle)` requires every cited id to be
  in the bundle. A decisive verdict must cite at least one `present` item that was
  `rendered` or `truncated` with some text shown (`renderedLength` above 0); an
  empty item cannot support it. A `truncated` item must keep some text, otherwise it
  is `withheld`. `unknown` and `insufficient` may cite nothing.
- `evidenceBundleIdentity` ignores item order and changes with any content, status,
  or render change. `contentIdentity` is supplied by the caller and is not verified.

## Task contract and rubric

- A `TaskContract` has a `taskClass` (an open string, never `*`), the task `text`, and
  acceptance items, each with a unique `id`, a `text`, and a `source` that uses the same
  origins as a criterion. `taskContractIdentity` ignores acceptance order.
- A `RubricSet` is a `proposal` or `frozen` set of entries. Each entry has a #6
  `criterion`, the acceptance ids it `covers`, the task classes it `appliesTo` (or `*`
  alone), and a `role` of `decisive` or `advisory`. `role` is a declaration; it has no
  gate meaning until #9.
- A `proposal` may omit anchors but not contradict itself: anchors must be verdicts the kind
  allows and must not repeat, and evidence ids must not repeat within a criterion. A
  `frozen` set must also pass every criterion rule, including one primary owner per
  evidence id. A mandatory criterion needs a source in both states.
- `validateRubricAgainstContract(rubric, contract)` requires the rubric's
  `contractIdentity` to match, every covered id to exist, and every entry to apply to the
  contract's task class. An entry that does not apply is an error, not skipped.
- A `CompilationReport` is derived, so it is checked:
  `validateCompilationReport(report, rubric, contract)` requires each acceptance id to be in
  exactly one of `covered`, `uncovered`, and `unsupported`; an id with covering entries is in
  `covered` and lists exactly those criteria; and each `merged` record names a criterion that
  exists and absorbed ids that no longer do. A survivor has one merged record, and an absorbed
  id goes to one survivor. A gap's `reason` must not be blank. `merged` records are caller
  supplied and not verified against the proposals, which this package never receives.
  A reason is blank when it has no character other than white space, control, format,
  nonspacing or enclosing combining marks, and the fixed glyphs U+115F, U+1160, U+3164,
  U+FFA0, U+2800. The glyph list is fixed, not a complete table of invisible characters.
- `excluded` lists proposals the compiler kept out of the rubric, each with `code`
  `not_applicable` or `conflict` and a non-blank `reason`. Its `criterionId`s must be unique,
  must not be a criterion in the rubric, and must not be absorbed by a `merged` record. Ids
  are compared exactly. Like `merged`, it is caller-supplied and not checked against the
  proposals. A report is complete when `uncovered` and `unsupported` are both empty; that is
  not stored.
- Input is copied once before it is validated, hashed, or returned, so inherited fields and
  stateful getters cannot make the validated data differ from the hashed data. This covers
  every validator, every identity function (the exported `identityOf` and `canonicalForm`
  accept `unknown`), and the evidence list that `measurementKey` receives. The copy accepts plain objects and arrays only:
  own enumerable string keys, each value read once, `toJSON` never called. It rejects a
  `Date`, a boxed primitive, a class instance, a function, a symbol, a bigint, a non-finite
  number, a lone surrogate (in a value or a key), an array hole, a cycle, an extra own
  property on an array, a symbol key, and a non-enumerable own property. An own property
  whose value is `undefined` is kept, so the schema and the identity see it as written: a
  validator treats it as absent for `required` and rejects it as an extra key, and identity
  fails with reason `undefined`. A throwing getter becomes a structured failure. An identity function reports the first
  rejected value in traversal order, with its path and reason (`undefined`, `not_finite`,
  `bigint`, or `unsupported`).
- `rubricIdentity(rubric, { contract, contextIdentity, instrument, policyIdentity })`
  changes with the rubric, the contract, the context, the instrument (model, decoding,
  prompt, runtime, repetitions), or the policy. Entry order does not matter.
  `contextIdentity` and `policyIdentity` are supplied by the caller and are not verified.
- Merging is recorded here, not decided. Producing a rubric and a report from a contract
  is #8b.

It does not own model calls, runtime state, filesystem execution, provider SDK
types, or benchmark fixture conventions. Prompt compilation, truncation, and
untrusted-content marking follow in #7b; calibration and gate semantics in #9.
