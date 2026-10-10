## 1. Issue, OpenSpec, and Initial PR

- [ ] 1.1 Confirm issue #27 owns only canonical serialization, hash, and
  identity.
- [ ] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [ ] 1.3 Validate the change with OpenSpec strict validation.
- [ ] 1.4 Create the change PR with OpenSpec artifacts before implementation
  and continue implementation on the same branch.

## 2. Implementation

- [ ] 2.1 Add `canonicalize` as a pinned dependency of `@lorelum/judge-protocol`
  and update `bun.lock`.
- [ ] 2.2 Add the JSON value type.
- [ ] 2.3 Add the input guard that rejects `undefined`, `NaN`, `Infinity`, and
  `bigint` with the path of the offending value.
- [ ] 2.4 Add canonical serialization and `identityOf` returning a result value.
- [ ] 2.5 Export the public API from the package entrypoint.

## 3. Tests

- [ ] 3.1 Add contract tests for key order, content change, array position,
  schema isolation, and each rejected input.
- [ ] 3.2 Add the RFC 8785 test vectors that fall inside the supported subset.

## 4. Documentation

- [ ] 4.1 Change `protocol -> none` to `protocol -> no workspace package` in
  `docs/architecture/repository-layout.md` and `AGENTS.md`, and note that
  limited external dependencies are allowed.
- [ ] 4.2 Update the `protocol` README.

## 5. Verification and Review

- [ ] 5.1 Run `bun install --frozen-lockfile`.
- [ ] 5.2 Run `bun run validate`.
- [ ] 5.3 Run `openspec validate protocol-canonical-identity --type change --strict`.
- [ ] 5.4 Load the built protocol entrypoint in Node ESM and compute one identity.
- [ ] 5.5 Read back the PR and record AI review findings and resolution.

## 6. Final Gate

- [ ] 6.1 Update the PR body with commands, results, deferred work, and
  verification evidence.
- [ ] 6.2 Confirm every acceptance criterion in #27 has evidence.
