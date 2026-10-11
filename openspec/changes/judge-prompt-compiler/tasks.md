## 1. Issue, OpenSpec, and Initial PR

- [ ] 1.1 Confirm issue #36 owns only the judge prompt compiler.
- [ ] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [ ] 1.3 Validate the change with OpenSpec strict validation.
- [ ] 1.4 Create the change PR with only OpenSpec artifacts first.

## 2. Normalization and Identity

- [ ] 2.1 Implement text normalization (NFC, line endings, trailing whitespace).
- [ ] 2.2 Implement the three identities with their schema names.

## 3. Compiler

- [ ] 3.1 Implement placeholder scanning and exact variable binding.
- [ ] 3.2 Implement budgeted evidence rendering in id order with headers.
- [ ] 3.3 Build and validate the manifest with `validateEvidenceBundle`.
- [ ] 3.4 Assemble system and user messages with the untrusted notice.
- [ ] 3.5 Wrap the whole compile in a guard so it never throws.

## 4. Tests

- [ ] 4.1 One test per spec scenario, accepted and rejected.
- [ ] 4.2 Order independence and mechanical-normalization stability.
- [ ] 4.3 Mutation checks: order-dependent rendering and re-scanning substitution.

## 5. Documentation

- [ ] 5.1 Write the `judge` README for the compiler and the three identities.
- [ ] 5.2 Update the `protocol` README to say code points, not characters.

## 6. Verification and Review

- [ ] 6.1 Run `bun install --frozen-lockfile`.
- [ ] 6.2 Run `bun run validate`.
- [ ] 6.3 Run `openspec validate judge-prompt-compiler --type change --strict`.
- [ ] 6.4 Import the built `judge` entrypoint in Node ESM and compile a sample.
- [ ] 6.5 Read back the PR and record AI review findings and resolution.

## 7. Final Gate

- [ ] 7.1 Update the PR body with commands, results, deferred work, and verification evidence.
- [ ] 7.2 Confirm every acceptance criterion in #36 has evidence.
