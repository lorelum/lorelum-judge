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
- `compilePrompt` never throws. Failures are `{ ok: false, issues }`.

Not here: calibration and gate semantics (#9), rubric authoring (#8), and any provider
call.
