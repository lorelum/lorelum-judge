## Why

#8a defined `TaskContract`, `RubricSet`, and `CompilationReport` and validates them, but
nothing produces a rubric from a contract. A rubric written by hand records no coverage
of the acceptance criteria, so nothing shows what it leaves uncovered or cannot support.
#9 and #10 both consume a compiled rubric and report.

## What Changes

- Add a rubric compiler in `@lorelum/judge`. It renders the task contract's acceptance
  criteria as evidence through `compilePrompt`, calls a caller-supplied `ModelPort` to
  propose criteria, and returns a proposal `RubricSet` with a `CompilationReport`.
- Model output is untrusted. Each proposal is validated with `validateCriterionDraft`.
  Any structural failure, unknown acceptance id in `covers`, or undeclared overlap fails
  the whole compilation with a structured, categorized issue. Nothing is repaired.
- A deterministic gate checks source, applicability to the task class, declared merges,
  and coverage, and produces the report with a `complete` flag.
- `freezeRubric` produces a frozen `RubricSet` only when the report is complete and every
  criterion has anchors. It requires no human review record.
- Acceptance criteria that exceed the evidence budget or cannot be rendered fail the
  compilation; the model is never asked to write a rubric for a truncated contract.
- Repo context is out of scope. A caller-supplied `contextIdentity` and `policyIdentity`,
  both `sha256:` identities, are required and bound, not verified. The issue's repo-context
  item is deferred and not claimed as done.

## Impact

Judge package, plus the OpenSpec change. Protocol shapes and identities come from
`@lorelum/judge-protocol` and are not redefined. Calibration and gate semantics stay in #9.
Depends on #43 (merged) for identity copy behavior. Model choice, decoding, and prompt
identity are recorded in `InstrumentProfile` and bound through `rubricIdentity`.
Retries, splitting, and output repair belong to workflow and are not here.
