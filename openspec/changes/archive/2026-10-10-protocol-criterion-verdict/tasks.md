## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #30 owns only criterion, verdict, anchor, and evidence
  ownership contracts.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [x] 1.4 Create the change PR with OpenSpec artifacts before implementation
  and continue implementation on the same branch.

## 2. Schemas and Generated Types

- [x] 2.1 Add `ajv` to `@lorelum/judge-protocol` and `json-schema-to-typescript`
  to the root dev dependencies, both pinned; update `bun.lock`.
- [x] 2.2 Add the `Criterion` and `Verdict` JSON Schemas under
  `packages/protocol/src/schemas`.
- [x] 2.3 Add `scripts/generate-protocol-types.ts` with a `--check` mode.
- [x] 2.4 Generate and commit `src/generated`, ignore it in `biome.json`, and add
  the check to `bun run validate`.

## 3. Validation

- [x] 3.1 Add the verdict table by criterion kind.
- [x] 3.2 Add `validateCriterion` with schema errors translated to issues.
- [x] 3.3 Add `validateCriteria` for duplicate ids and duplicate primary evidence.
- [x] 3.4 Add `validateVerdict`.
- [x] 3.5 Export the public API without third-party validator types.

## 4. Tests

- [x] 4.1 Cover each requirement scenario in the specification, accepted and
  rejected.
- [x] 4.2 Cover invalid input returning issues without throwing.
- [x] 4.3 Prove a stale generated file makes the check fail, using a throwaway
  edit that is reverted.

## 5. Documentation

- [x] 5.1 Update the `protocol` README with the new contracts.

## 6. Verification and Review

- [x] 6.1 Run `bun install --frozen-lockfile`.
- [x] 6.2 Run `bun run validate`.
- [x] 6.3 Run `openspec validate protocol-criterion-verdict --type change --strict`.
- [x] 6.4 Import the built entrypoint in Node ESM and validate one criterion and
  one verdict.
- [x] 6.5 Read back the PR and record AI review findings and resolution.
  Findings 1 to 6 of the first review were fixed in this change; finding 7's
  schema location question is left for the maintainer. See the PR body.

## 7. Final Gate

- [x] 7.1 Update the PR body with commands, results, deferred work, and
  verification evidence.
- [x] 7.2 Confirm every acceptance criterion in #30 has evidence.
