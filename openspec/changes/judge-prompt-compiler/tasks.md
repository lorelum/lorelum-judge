## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #36 owns only the judge prompt compiler.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [x] 1.4 Create the change PR with only OpenSpec artifacts first.

## 2. Normalization and Identity

- [x] 2.1 Implement text normalization (NFC, line endings, trailing whitespace).
- [x] 2.2 Implement the three identities with their schema names.

## 3. Compiler

- [x] 3.1 Implement placeholder scanning and exact variable binding.
- [x] 3.2 Implement budgeted evidence rendering in id order with headers.
- [x] 3.3 Build and validate the manifest with `validateEvidenceBundle`.
- [x] 3.4 Assemble system and user messages with the untrusted notice.
- [x] 3.5 Wrap the whole compile in a guard so it never throws.

## 4. Tests

- [x] 4.1 One test per spec scenario, accepted and rejected.
- [x] 4.2 Order independence and mechanical-normalization stability.
- [x] 4.3 Mutation checks: order-dependent rendering and re-scanning substitution.

## 5. Documentation

- [x] 5.1 Write the `judge` README for the compiler and the three identities.
- [x] 5.2 Update the `protocol` README to say code points, not characters.

## 6. Verification and Review

- [x] 6.1 Run `bun install --frozen-lockfile`.
- [x] 6.2 Run `bun run validate`.
- [x] 6.3 Run `openspec validate judge-prompt-compiler --type change --strict`.
- [x] 6.4 Import the built `judge` entrypoint in Node ESM and compile a sample.
- [ ] 6.5 Read back the PR and record AI review findings and resolution.

## 7. Final Gate

- [x] 7.1 Update the PR body with commands, results, deferred work, and verification evidence.
- [x] 7.2 Confirm every acceptance criterion in #36 has evidence.

## 8. Review Fixes (changes requested on the PR)

- [x] 8.1 Bindings are own properties only (Map), with prototype-name tests.
- [x] 8.2 Escape `<evidence` and `</evidence` in candidate text before lengths and hashing, with tests.
- [x] 8.3 Empty present evidence: recorded, cannot support a decisive verdict, with test.
- [x] 8.4 Identity failure returned as an issue instead of thrown.
- [x] 8.5 Document that the budget covers evidence text only.
- [ ] 8.6 Confirm the rule change (rules not counted) with the maintainer before merge.
