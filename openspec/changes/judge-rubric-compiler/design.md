## Context

`packages/judge` currently holds only the prompt compiler (#7). `packages/protocol` owns
the contract, rubric, and report shapes and their identity functions. The compiler is the
only producer of `CompilationReport` and of frozen `RubricSet` values in this repository.

## Decisions

1. Pure function. Input is a validated `TaskContract` plus a list of proposed criteria.
   Output is a value. No I/O, no clock, no model call.
2. Applicability is a rule, not a model judgment. A criterion applies when its `appliesTo`
   contains the contract's `taskClass` or `*`. Non-applicable proposals are reported as
   `not_applicable` and do not enter the rubric.
3. Mandatory criteria must carry a `user`, `policy`, or `contract` source. A mandatory
   criterion without one is rejected at compile time; it does not reach the report.
4. Proposals without anchors stay in the proposal state. `freezeRubric` refuses them.
5. Merge is declared, never inferred. Two criteria merge only when a proposal names the
   surviving id in `mergedFrom`. Undeclared overlap of covers is reported as a conflict.
6. `complete` is true only when every mandatory acceptance id is covered, no acceptance id
   is unsupported, and there are no conflicts. Otherwise `freezeRubric` fails with the
   incomplete items.
7. Identity is computed by `rubricIdentity` and `taskContractIdentity` from #8a. The
   compiler does not reimplement hashing or copying.

## Risks

- Overlap detection by covers can miss semantic overlap. Mitigation: the report states
  that overlap is detected by covered ids only, and review must confirm declared merges.
- The applicability rule can hide a criterion that a human would apply. Mitigation: the
  report keeps `not_applicable` entries visible.
