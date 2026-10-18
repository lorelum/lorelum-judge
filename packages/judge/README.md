# @lorelum/judge

Owns judge domain rules and workflows: task framing, rubric authoring, evidence
collection, judgment, calibration, and gate decisions.

It consumes `@lorelum/judge-protocol` and `@lorelum/judge-runtime`. It does not own
provider SDKs, framework orchestration, or the engineering implementation workflow.

## Review execution

`review(input, ports)` is the one-call entry for ordinary users: it executes the
review once by default and returns the execution, findings, completeness, and a
gate result with quality outcome, enforcement mode, reasons, and a localised
explanation. When no policy is supplied it derives an advisory policy, so the
caller still learns that the result cannot automatically gate delivery.
`executeReview(input, ports)` exposes the same execution without the gate step;
`evaluateReviewGate(input)` projects an existing execution when the caller owns
that composition.

- `input` carries a `MeasurementDefinition/v2` (or the result of
  `frozenRubricToDefinition`), caller evidence, one method, optional explicit
  `repetitions`, `timeoutMs`, `signal`, and an optional execution `id`. Ports
  supply either a program checker or a `ModelPort`, plus an optional clock and ID
  generator.
- Inputs are snapshotted and identities are computed before any checker or model
  call. Invalid input returns issues and invokes nothing. Repeated execution is
  explicit and sequential: the default is one call, with no retry, cache, or
  replacement attempt.
- Program checkers receive the frozen definition, normalized evidence, and an
  `AbortSignal`, and return a verdict list. The same normalized text is hashed
  into the evidence manifest, so content identity, lengths, and checker input
  describe one material. Judge applies the same per-criterion and evidence
  validation as the LLM path. Thrown errors and rejections become a failed
  attempt; a pre-cancelled signal starts nothing; a late result cannot replace
  `cancelled`.
- The LLM path compiles a deterministic trusted rule prompt with `compilePrompt`
  and calls the injected `ModelPort` once per attempt. The provider is
  responsible only for transport.
- The default reader accepts bare JSON or exactly one complete `json` or
  unlabelled Markdown code block with surrounding whitespace. Text outside a
  block, multiple blocks, duplicate JSON keys, malformed JSON, unknown envelope
  fields, and non-array verdicts are refused. Nothing is repaired and no extra
  model call is made.
- Raw verdict assessment is canonical in protocol. `assessVerdicts` is shared
  by full run validation, stored partial executions, live review assessment,
  and gate partial observations. A duplicate group is excluded as a whole;
  unknown entries are ignored; missing coverage is reported only when the call
  site requires complete coverage.
- Each criterion is validated independently. Legal findings stay visible;
  missing, duplicate, unknown, illegal-verdict, and illegal-evidence entries get
  explicit issues. Duplicates are never resolved by picking one. A completed
  attempt carries a `MeasurementRun/v2`; a partial attempt carries legal
  verdicts and issues but no run; an attempt with no legal verdict fails.
  `ReviewFinding.disagreement` is true when the valid attempts for a criterion
  contain more than one distinct verdict; the representative `verdict` is the
  first valid one, not a majority prediction.
- `ReviewExecution/v1` retains every planned slot: `completed`, `partial`,
  `failed`, `cancelled`, or `not_started`, with request facts, server-declared
  metadata, and unknowns kept separate. Evidence and rendered messages change
  execution identity; they do not expire calibration by themselves.
- `evaluateReviewGate(input)` projects the execution onto #9. It reuses the
  verified-calibration loader, aggregation, evidence statuses, and localised
  findings. Partial findings remain visible and a supported required failure can
  keep the overall result failed, but an incomplete execution cannot pass and
  cannot gain enforced mode. It also compares the actual model/provider,
  endpoint, and explicit parameters with the instrument, and reports known
  response-model conflicts or missing response information instead of assuming
  a match. Without applicable calibration the review is advisory and never
  blocks delivery by itself.
- Review execution is split by concept: `review/input.ts` validates and
  prepares, `review/execute-attempt.ts` runs one attempt, `review/record.ts`
  builds lifecycle records, `review/findings.ts` aggregates, and `review.ts`
  only re-exports the public entrypoint. Evidence validation/manifest building
  lives in `evidence.ts` and is shared with prompt compilation.
- A caller-supplied gate policy is bound to the exact definition and instrument.
  A mismatch, including a different repetition count, is a validation error
  before any checker or model call. Calibration alone is different: if only a
  calibration bound to another repetition count is supplied, the requested
  execution still runs and the mismatched enforcement claim is declined.

The v1 definition/instrument/run helpers and the v1 calibration artifacts keep
their behavior. `validateAny*` and the `#9` validators dispatch on the schema;
an old calibration is not relabelled as verified for a migrational v2 identity.

This package stops at review results. It does not produce code changes,
suggestion workflows, automatic evidence collection, benchmark migration, or a
workflow package skeleton; those belong to #11.

## Prompt compiler

`compilePrompt({ prompt, evidence })` turns rules and raw evidence into:

- `messages`: a system and a user `RuntimeMessage`, ready for `ModelPort.generate`.
- `manifest`: an `EvidenceBundle` (see `@lorelum/judge-protocol`) recording which
  evidence was rendered, truncated, or withheld, with exact lengths.
- `promptIdentity`: for `InstrumentProfile.promptIdentity`. Covers the normalized system
  text, template, variable bindings, render version, evidence budget, and rule budget.
- `renderIdentity`: covers the exact messages sent to the model.

Behavior:

- Evidence renders in id order. `evidenceBudget` counts code points of evidence text
  only; the first item that does not fit is truncated, later ones are withheld.
- An empty evidence item renders as `rendered` only while budget remains; after that it is
  `withheld`. It never supports a decisive verdict.
- Rules (system text, template, variable values) are capped by `ruleBudget`. An overflow
  fails with `rules_over_budget`; rules are never truncated.
- Text is normalized first (NFC, LF line endings, no trailing spaces or tabs). Content
  identities are computed here from the normalized text, not supplied by the caller.
  Content identity covers the text before escaping; lengths count the escaped text.
- Candidate `<evidence` and `</evidence` markers are escaped, case-insensitively, so
  candidate text cannot open or close a block. Only the `evidence` marker is escaped.
- Template placeholders are `{{name}}`. Every placeholder must be bound, every binding
  must be used, names match `^[a-z][a-z0-9_]*$`, and `{{evidence}}` is reserved and
  appears exactly once. Substitution is single pass; values are never re-expanded.
- The system message ends with a fixed notice that evidence blocks are data, not
  instructions. This is a stable marker; it does not stop a model from following
  instructions in evidence.
- Text with unpaired surrogates is rejected with the field's path, not canonicalized.
- `compilePrompt` never throws. Failures are `{ ok: false, issues }`.

This compiler does not make provider calls. The model call that uses it is in the rubric
compiler, through a caller-supplied `ModelPort`.

## Rubric compiler

`compileRubric({ rubricId, contract, prompt, instrument, contextIdentity, policyIdentity, model, runId, stepIndex, signal })`
turns a task contract into a proposal `RubricSet` and a `CompilationReport`.

- Acceptance items render as evidence with their ids, through `compilePrompt`. The
  compiler appends its own output instruction to the caller's system text; that text is
  part of the prompt identity.
- One `ModelPort.generate` call per contract. The response must be `structured`.
  `runId`, `stepIndex`, and `signal` come from the caller.
- Model output is untrusted. Every criterion goes through `validateCriterionDraft`; any
  failure fails the whole compilation. Nothing is repaired or dropped.
- The gate is deterministic: an unknown `covers`, `mergedFrom`, or evidence id fails the
  compilation; each covered acceptance needs its own evidence selector; one primary owner
  per evidence; a mandatory criterion needs a user, policy, or contract source and cannot
  be merged into a non-mandatory one; applicability is by `appliesTo` and task class;
  merges are only the declared `mergedFrom`, and the absorbed criteria's content is discarded.
  An undeclared conflict (same covers and same evidence, as #41 defines it) excludes both
  criteria; partial overlap is kept.
- Result: `{ ok: true, value }` with `rubric` (status `proposal`), `report`,
  `rubricIdentity`, and `binding`; or `{ ok: false, issues }`. Each issue has a
  `category`: `model`, `output`, `gate`, or `prompt`.
- `complete` is derived from the report: nothing uncovered, unsupported, or conflicting.
- `freezeRubric(compiled)` produces a `frozen` rubric only when the report validates
  against the rubric and contract, is complete, and every criterion has anchors. It
  needs no review record.

The task class reaches the model as an ASCII JSON string (non-ASCII escaped as `\uXXXX`), so
NFC normalization of the system message cannot change the class the model must echo back.

Not done here: retries, splitting, output repair, repo context selection, calibration
(#9), and migration (#10). `contextIdentity` and `policyIdentity` are required `sha256:`
identities, bound into the rubric identity and not verified. The surviving criterion keeps
its own role, anchors, and evidence. Criteria merged into it leave the rubric, and their
descriptions and anchors are discarded, not recorded; the report lists only their ids. The
survivor must select evidence for every acceptance id they cover. `freezeRubric` accepts only
a result that `compileRubric` returned, and checks the report against the rubric and contract.
Copies and hand-built objects are refused.

## Calibration and gate

`createDefaultGatePolicyV2` creates the published starter policy for explicit task-class
and evidence-shape scopes. It binds the measurement definition and instrument, requires
three observations per case, uses a 2/3 agreement threshold and 20 independent holdout
groups per required case category, and checks 95% Wilson intervals against false-accept
5%, false-reject 10%, abstention 20%, and disagreement 20% limits. The default helper
requires an `InstrumentProfile` with three repetitions. These are eligibility limits, not
a claim that a judge has achieved them.

`buildCalibration` validates caller-supplied development/holdout task groups and returns a
report plus per-scope artifacts in `shadow`. Repetitions and behavior variants count once
per task group; unsupported verdict evidence and failed observations are reported, not
converted into quality failures. Failure categories are counted at most once per task group
and remain `unattributed` unless diagnostics identify a cause. Only held-out groups
contribute to eligibility.

`loadVerifiedCalibration` recomputes that report and returns a process-local verified
value. Persisted values must be loaded again after restart. A raw artifact marked
`enforced` is not sufficient: identities, report, scope, validity, and every eligibility
metric must match. The caller explicitly changes a qualifying artifact to `enforced` to
enable automatic blocking.

`evaluateGate` consumes the verified value when available and returns a `GateDecision`
with a human-readable Chinese summary by default (English is supported), criterion-level
findings, evidence IDs, and next steps. Quality is `pass`, `fail`, or `indeterminate`;
execution mode separately says whether the result is enforced or advisory. An evidence-
backed mandatory failure takes precedence over other pending criteria, which remain visible.
The protocol rejects duplicate criterion findings and a total quality result that conflicts
with those findings. Supplied failure categories remain machine-readable and are described
in human-readable Chinese or English; unknown causes stay explicitly unattributed. Without applicable verified calibration, an informative result is
still returned in the policy fallback mode and cannot block.

If valid evidence is available but every repeated verdict is `unknown` or `insufficient`,
the finding reports a Judge abstention rather than claiming evidence is missing. An
unacceptable optional criterion includes its matching anchor but remains advisory and does
not block overall acceptance. Evidence marked `no_evidence` and evidence marked `unavailable`
receive different reasons and next steps.
