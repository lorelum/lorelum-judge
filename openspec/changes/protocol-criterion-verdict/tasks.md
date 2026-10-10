## 1. Issue, OpenSpec, and Initial PR

- [ ] 1.1 Confirm issue #30 owns only criterion, verdict, anchor, and evidence
  ownership contracts.
- [ ] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [ ] 1.3 Validate the change with OpenSpec strict validation.
- [ ] 1.4 Create the change PR with OpenSpec artifacts before implementation
  and continue implementation on the same branch.

## 2. Schemas and Generated Types

- [ ] 2.1 Add `ajv` to `@lorelum/judge-protocol` and `json-schema-to-typescript`
  to the root dev dependencies, both pinned; update `bun.lock`.
- [ ] 2.2 Add the `Criterion` and `Verdict` JSON Schemas under
  `packages/protocol/src/schemas`.
- [ ] 2.3 Add `scripts/generate-protocol-types.ts` with a `--check` mode.
- [ ] 2.4 Generate and commit `src/generated`, ignore it in `biome.json`, and add
  the check to `bun run validate`.

## 3. Validation

- [ ] 3.1 Add the verdict table by criterion kind.
- [ ] 3.2 Add `validateCriterion` with schema errors translated to issues.
- [ ] 3.3 Add `validateCriteria` for duplicate ids and duplicate primary evidence.
- [ ] 3.4 Add `validateVerdict`.
- [ ] 3.5 Export the public API without third-party validator types.

## 4. Tests

- [ ] 4.1 Cover each requirement scenario in the specification, accepted and
  rejected.
- [ ] 4.2 Cover invalid input returning issues without throwing.
- [ ] 4.3 Prove a stale generated file makes the check fail, using a throwaway
  edit that is reverted.

## 5. Documentation

- [ ] 5.1 Update the `protocol` README with the new contracts.

## 6. Verification and Review

- [ ] 6.1 Run `bun install --frozen-lockfile`.
- [ ] 6.2 Run `bun run validate`.
- [ ] 6.3 Run `openspec validate protocol-criterion-verdict --type change --strict`.
- [ ] 6.4 Import the built entrypoint in Node ESM and validate one criterion and
  one verdict.
- [ ] 6.5 Read back the PR and record AI review findings and resolution.

## 7. Final Gate

- [ ] 7.1 Update the PR body with commands, results, deferred work, and
  verification evidence.
- [ ] 7.2 Confirm every acceptance criterion in #30 has evidence.
