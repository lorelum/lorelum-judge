## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #40 owns the `excluded` list and nothing else in the report.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with `openspec validate protocol-compilation-report-decisions --type change --strict`.
- [x] 1.4 Create the change PR with the OpenSpec artifacts on `codex/protocol-compilation-report-decisions`.

## 2. Schema and Types

- [x] 2.1 Add the required `excluded` array to `compilation-report.schema.json`, with `criterionId`, `code` (`not_applicable` | `conflict`), and `reason`, and `additionalProperties: false`.
- [x] 2.2 Regenerate the protocol types with `bun run generate:protocol` and confirm `check:protocol-types` is clean.

## 3. Validation

- [x] 3.1 Reject duplicate `criterionId` values in `excluded`.
- [x] 3.2 Reject an `excluded` id that is a criterion in the rubric.
- [x] 3.3 Reject an `excluded` id that appears in any `mergedFrom`.
- [x] 3.4 Reject a blank `reason` in `excluded`, using the same rule as gaps.
- [x] 3.5 Reject a report that omits `excluded`.

## 4. Tests

- [x] 4.1 Accept a report with one `not_applicable` and one `conflict` item.
- [x] 4.2 Reject each rule in 3.1 to 3.5 with its own test.
- [x] 4.3 Update every report fixture to include `excluded`.
- [x] 4.4 Mutation-check 3.1 to 3.5: each removed check must cause at least one failing test.

## 5. Documentation

- [x] 5.1 Update the protocol README and the report requirement in the spec to describe `excluded` and the verification limits.

## 6. Verification and Review

- [x] 6.1 Run `bun run validate`, including the Node ESM smoke test.
- [x] 6.2 Run `openspec validate protocol-compilation-report-decisions --type change --strict`.
- [x] 6.3 Read back the PR body and the issue; record AI assistance and independent review.

## 7. Final Gate

- [x] 7.1 Update the PR body with commands, results, deferred work, and verification evidence.
- [x] 7.2 Confirm every acceptance criterion in #40 has evidence.
