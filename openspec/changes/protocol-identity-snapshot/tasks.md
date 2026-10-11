## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #42 owns the identity functions and the copy's four holes, and nothing else.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with `openspec validate protocol-identity-snapshot --type change --strict`.
- [ ] 1.4 Create the change PR on `codex/protocol-identity-snapshot`. It also carries the archive of `protocol-compilation-report-decisions`, which was not archived before #41 merged.

## 2. Copy

- [x] 2.1 Keep `undefined`-valued own properties in the copy.
- [x] 2.2 Reject symbol keys, non-enumerable own properties, and lone-surrogate keys with a path.
- [x] 2.3 Reject extra own properties on arrays with a path.
- [x] 2.4 Throw a typed error that carries the path, so identity can report it.

## 3. Identity

- [x] 3.1 `identityOf` and `canonicalForm` accept `unknown`, copy first, and map copy failures to `{ ok: false, error: { reason: "unsupported", path } }`.
- [x] 3.2 Remove the stale trusted-input comment in `identity.ts`.

## 4. Tests

- [x] 4.1 `identityOf` of a `Date` differs from its ISO string, or fails. Pin the failure.
- [x] 4.2 `identityOf` of a class instance fails.
- [x] 4.3 `identityOf` with a throwing getter returns a failure, not a throw.
- [x] 4.4 `identityOf` with a lone surrogate returns a failure.
- [x] 4.5 `identityOf` with a deep input returns a failure.
- [x] 4.6 A validated record with an `undefined` property fails identity; a validator with an extra `undefined` key rejects it.
- [x] 4.7 Symbol key, non-enumerable property, lone-surrogate key, and array extra property are each rejected by `snapshot`.
- [x] 4.8 Golden identities of plain valid input are unchanged (existing identity compatibility tests keep passing).
- [x] 4.9 Mutation-check each rule in section 2 and 3: removing it must fail at least one test.
- [x] 4.10 Delete the test that pinned the old drop behaviour (`a property that is undefined is absent from the copy`), because it pins behaviour this change removes.

## 5. Documentation

- [x] 5.1 Update the protocol README: identity functions copy their input; `undefined` properties are kept; the list of rejected inputs.
- [x] 5.2 Update the design text in `snapshot`'s doc comment and in `identity.ts`.

## 6. Verification and Review

- [x] 6.1 Run `bun run validate`, including the Node ESM smoke test.
- [x] 6.2 Run `openspec validate protocol-identity-snapshot --type change --strict`.
- [x] 6.3 Smoke the built `dist` in Node ESM with `identityOf(new Date(0))`, a class instance, and a valid contract.
- [ ] 6.4 Independent review pinned to the final SHA, recorded in the PR.

## 7. Final Gate

- [ ] 7.1 Update the PR body with commands, results, review rounds, and deferred work.
- [ ] 7.2 Confirm every item of #42's acceptance criteria has evidence.
