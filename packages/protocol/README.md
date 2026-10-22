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
defects (symbol keys, hidden properties, extra array properties) come before its children.
Same content gives the same identity regardless of key order; the schema identifier keeps
record types apart.

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
  `evaluateEnforcement` preserves this v1 identity-only compatibility behavior; new
  enforcement must use the v2 qualification contract and Judge verifier.
- `evaluateEnforcement({ definition, instrument, gatePolicy, calibration })`
  allows enforcement only for an `enforced` calibration whose definition,
  instrument, and gate policy identities all match. Otherwise it returns the
  reasons that apply and the policy's degradation, or `invalid_input` when an input cannot
  be read.
- `measurementKey(definition, instrument, evidenceIdentities)` is a cache key.
  Evidence order and duplicates do not change it.

## Review definitions, methods and executions (v2)

`MeasurementDefinition/v2`, `InstrumentProfile/v2`, `MeasurementRun/v2`, and
`ReviewExecution/v1` are additive. The v1 schemas, validators, and identities
above keep their behavior; `validateAnyDefinition`, `validateAnyInstrument`,
`validateAnyRun`, `anyDefinitionIdentity`, and `anyInstrumentIdentity` dispatch
on the record's `schema`.

- A v2 definition carries the same criteria plus one metadata record per
  criterion: `criterionId`, `role` (`decisive` or `advisory`), and optional
  `covers` and `appliesTo`. Metadata must match criteria one to one. The
  original `criterion.mandatory` is never rewritten. A criterion is required
  only when `role` is `decisive` and `mandatory` is true; `isRequiredCriterion`
  and `requiredCriterionIds` expose that rule. `provenance` records either a
  source rubric (`rubricId`, `rubricIdentity`, `contractIdentity`) or an
  explicit v1 migration (`migratedFrom`, `sourceIdentity`).
- `frozenRubricToDefinition(rubric, { id? })` accepts only a frozen `RubricSet`.
  It preserves criteria, role, covers, appliesTo, contract identity, and the
  computed rubric identity. A proposal is refused.
- `migrateDefinitionV1(definition)` creates a v2 definition with `role:
  decisive` and a migration source. Its identity differs from the v1 identity,
  so an old calibration cannot silently bind to it.
- `InstrumentProfile/v2.method` is either `program` or `llm`. A program method
  names its checker and version or content identity, implementation, result
  protocol, parser, runtime, and repetitions; it has no model, decoding, or
  prompt fields. An LLM method adds provider protocol and adapter version,
  endpoint identity, requested model, explicit decoding, prompt/compiler/render
  and parser identities. Credentials are not fields of any record.
- `validateMeasurementRunV2(definition, instrument, run)` still requires
  exactly one valid verdict per criterion, matches both identities, and requires
  `executionId` and `evidenceIdentity`. An LLM run also requires
  `renderIdentity`; a program run must not carry one. A partial execution is
  never a `MeasurementRun/v2`.
- `ReviewExecution/v1` records `plannedCount` and one attempt per plan slot,
  including `not_started`. Statuses are `completed`, `partial`, `failed`,
  `cancelled`, and `not_started`. A completed attempt carries a complete v2 run;
  a partial attempt carries only legal verdicts and explicit issues; a failed
  attempt carries a structured failure; `not_started` carries no start time,
  response, or run. LLM request and response metadata are whitelisted, and
  unknowns are listed separately. `validateReviewExecution` enforces these
  invariants against the definition and instrument.
- Calibration dataset observations accept either v1 or v2 runs. `#9`
  cross-record validators and the Judge verified loader use the version
  dispatchers, so v1 artifacts keep their identity and a v2 method is not
  silently treated as the v1 record.

## Code evaluation records

`CodeTarget`, `SourceSnapshot/v1`, `ReviewPlan/v1`, `ReviewResult/v2`,
`ReviewExecution/v2` and `CodeEvaluationReport/v1` support source-aware qualitative
evaluation. Their validators and schema-specific identity helpers do not change
existing verdict, measurement, calibration or gate semantics.

- Source items bind raw-content identity, version, side and original line range.
  `projectCodeSource` is the canonical numbered-line projection; normalization and
  evidence identity remain separate from original bytes. Comparison manifests may
  record reader-established additions/deletions; missing excerpts do not prove absence.
- `ReviewPlan.evidenceBudget` bounds final evidence projection as well as
  preparation and participates in plan identity. It does not limit the trusted
  instructions or structural metadata.
- v2 results retain `Verdict/v1` and add observations, multiple problems per
  criterion, pending conditions and explicit opinion/reassessment references.
  Locations must cite code actually shown, on the correct side and version.
- A v2 execution records the source/plan, versioned parser and actual model facts.
  Illegal detail makes the attempt partial even if every verdict is legal; partial
  attempts never produce a complete measurement run. Rejected details remain in
  diagnostics/raw result rather than being silently discarded.
- Reports bind those records and distinguish execution status from incomplete
  goals. A report identity is not calibration or delivery permission. No score,
  credential or provider SDK object belongs to these contracts.
- The `code-evaluation.schema.json` definitions describe source, plan, result and
  report; `review-execution-v2.schema.json` binds their execution. Existing v1
  review and gate consumers retain their schemas and defaults.

## Calibration and gate records

Calibration datasets, reports, and user-facing gate decisions are new v1 records.
`GatePolicy/v2` carries acceptance rules, scope, repeated-verdict agreement, sample
coverage, uncertainty level, error limits, and fallback mode. `CalibrationArtifact/v2`
binds the definition, instrument, dataset, policy, report, scope, status, and validity
interval. Their validators check cross-record identities, task-group split isolation,
criterion verdict kinds, repetition counts, and evidence citations. TypeScript interfaces
are generated from the versioned JSON schemas.

Each group carries a stable source-task identity so variants cannot be moved between
development and holdout by changing record IDs.

Report rates require complete, count-consistent Wilson intervals (or no estimates when
their denominator is zero). Failure counts preserve the supplied taxonomy and are limited
to one event per task group. Gate-decision validation checks that the overall quality result
agrees with its criterion findings and retains supplied failure categories. The protocol reports structured facts and reason codes;
the Judge package formats them into user-readable Chinese or English. Localization does
not change measurement identity. A v1 artifact remains readable but cannot establish v2
calibration eligibility.

Evidence-based findings retain each required evidence ID's status (`missing`, `unavailable`,
`truncated`, `contradiction`, `unsupported`, or `available`) so mixed conditions remain visible.

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
  accept `unknown`), and the evidence list that `measurementKey` receives.
  `evaluateEnforcement` copies `gatePolicy` once, because both the degradation and the
  identity read it; its other fields are copied, and read once, by the validator or identity
  function that consumes them.
- The copy accepts plain objects and plain arrays only (prototype `Object.prototype`, or
  `null` for objects; `Array.prototype` for arrays): own enumerable keys, each value read
  once, `toJSON` never called. It rejects a `Date`, a boxed primitive, a class instance, an
  array subclass, a function, a symbol, a bigint, a non-finite number, a lone surrogate (in a
  value or a key), an array hole, a cycle, an extra own property on an array, a symbol key,
  a non-enumerable own property (including an array element), and any read that throws. A
  getter that throws is reported at the property it reads. An own property whose value is
  `undefined` is kept, so the schema and the identity see it as written: a validator treats
  it as absent for `required` and rejects it as an extra key, and identity fails with reason
  `undefined`.
- An identity function reports the first rejected value in traversal order, with its path
  and reason (`undefined`, `not_finite`, `bigint`, or `unsupported`). A node's own structural
  defects (symbol keys, hidden properties, extra array properties) come before its children.
  The validator-based identity functions (`definitionIdentity`, `instrumentIdentity`,
  `gatePolicyIdentity`, `taskContractIdentity`, `rubricIdentity`, `evidenceBundleIdentity`)
  run their validator first, so the validator's issues are reported; the reason codes are
  what `identityOf` and `canonicalForm` report when called directly.
- `rubricIdentity(rubric, { contract, contextIdentity, instrument, policyIdentity })`
  changes with the rubric, the contract, the context, the instrument (model, decoding,
  prompt, runtime, repetitions), or the policy. Entry order does not matter.
  `contextIdentity` and `policyIdentity` are supplied by the caller and are not verified.
- Merging is recorded here, not decided. Producing a rubric and a report from a contract
  is #8b.

It does not own model calls, runtime state, filesystem execution, provider SDK
types, or benchmark fixture conventions. Prompt compilation, truncation, and
untrusted-content marking follow in #7b; calibration and gate semantics in #9.
