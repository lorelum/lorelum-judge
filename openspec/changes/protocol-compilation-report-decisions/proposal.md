## Why

`CompilationReport` (#38) cannot record why a proposal did not reach the rubric. The #8b compiler drops a proposal for two reasons: it does not apply to the contract's task class, or it conflicts with another proposal that covers the same acceptance items and evidence with a different evaluation. Without a record, a reviewer sees a missing criterion and no explanation, and a conflict looks the same as an uncovered item.

## What Changes

- Add a required `excluded` list to `CompilationReport`. Each item is `{ criterionId, code, reason }` with `code` either `not_applicable` or `conflict`.
- Validate `excluded`: `criterionId` is unique within the list, is not a criterion in the rubric, is not absorbed by any `merged` record, and `reason` is non-blank.
- Keep `complete` out of the protocol. It is derived from the report: `uncovered` and `unsupported` are both empty.

## Impact

- Breaking for `CompilationReport`: the field is required and there is no compatibility shim. Every fixture and generated type moves with it.
- No change to `TaskContract`, `RubricSet`, identities, or the other capabilities.
- Like `merged`, `excluded` is caller-supplied and is not checked against the proposals, because this package never receives them.
