## Why

#8a defined `TaskContract`, `RubricSet`, and `CompilationReport` and validates them, but
nothing produces a rubric from a contract. Without a compiler, a rubric is hand-written,
and nothing records which acceptance criteria it covers, leaves uncovered, or cannot
support. #9 and #10 both consume a compiled rubric and report.

## What Changes

- Add a deterministic compiler in `@lorelum/judge`: `compileRubric({ contract, proposals })`
  returns `{ ok, rubric, report }` or structured issues. It never throws and never calls a
  model.
- Caller-supplied criteria are proposals. They are classified as applicable or
  not applicable to the contract's task class, checked for source and anchors, and merged
  only when the merge is declared.
- The report lists covered, uncovered, merged, unsupported, and conflicting items, and a
  `complete` flag.
- `freezeRubric` produces a frozen `RubricSet` only when the report is complete.

## Impact

Judge package only. Protocol shapes and identities come from `@lorelum/judge-protocol`
and are not redefined. Changes no measurement, calibration, or gate semantics. Depends on
#43 (identity copy fixes) being merged first, because the compiler binds rubric identity.
Dynamic generation by a model is out of scope; no provider is used.
