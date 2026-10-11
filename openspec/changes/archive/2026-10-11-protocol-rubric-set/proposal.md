## Why

Criteria can be validated (#6) and rendered (#7), but nothing says where a criterion
comes from or what it is supposed to cover. A rubric that cannot be traced to the task's
acceptance criteria is a rubric someone invented. AGENTS.md lists `TaskContract` as
something this repository owns, yet it has no shape. #8b's compiler, #9's calibration,
and #10's migration all need one, and the benchmark repository must be able to hand a
task in through the public protocol.

## What Changes

- Add `TaskContract`, `RubricSet`, and `CompilationReport` JSON Schemas, generated
  types, and validators in `@lorelum/judge-protocol`.
- Add `validateRubricAgainstContract` and `validateCompilationReport`, which check a
  rubric and a report against the contract they claim to describe.
- Add `taskContractIdentity` and `rubricIdentity`.

## Impact

Contract-class change to `packages/protocol`. No judge, runtime, or workflow changes.
The compiler that produces rubrics and reports is #8b. Calibration and gate semantics
stay in #9.
