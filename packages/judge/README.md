# @lorelum/judge

Owns judge domain rules and workflows: task framing, rubric authoring, evidence
collection, judgment, calibration, and gate decisions.

It consumes `@lorelum/judge-protocol` and `@lorelum/judge-runtime`. It does not own
provider SDKs, framework orchestration, or the engineering implementation workflow.

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

Not here: calibration and gate semantics (#9), and any provider call. The model call that
uses this compiler is in the rubric compiler, through a caller-supplied `ModelPort`.

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
  merges are only the declared `mergedFrom`; undeclared overlap is a `conflict`.
- Result: `{ ok: true, value }` with `rubric` (status `proposal`), `report`,
  `rubricIdentity`, and `binding`; or `{ ok: false, issues }`. Each issue has a
  `category`: `model`, `output`, `gate`, or `prompt`.
- `complete` is derived from the report: nothing uncovered, unsupported, or conflicting.
- `freezeRubric(compiled)` produces a `frozen` rubric only when the report validates
  against the rubric and contract, is complete, and every criterion has anchors. It
  needs no review record.

Not done here: retries, splitting, output repair, repo context selection, calibration
(#9), and migration (#10). `contextIdentity` and `policyIdentity` are required `sha256:`
identities, bound into the rubric identity and not verified. The surviving criterion keeps
its own role, anchors, and evidence; criteria merged into it leave the rubric, and the
survivor must select evidence for every acceptance id they cover. `freezeRubric` checks
the report against the rubric and contract, not the proposal-time merge rules, so
`compileRubric` is the only supported producer of a compiled rubric.
