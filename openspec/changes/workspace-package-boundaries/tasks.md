## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #3 owns only package boundaries and import enforcement.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [ ] 1.4 Create the initial PR with OpenSpec artifacts only.

## 2. Core Package Boundaries

- [ ] 2.1 Add `protocol`, `runtime`, `judge`, `workflow`, `testing`, and
  `adapters` package manifests.
- [ ] 2.2 Add package READMEs, no-op public entrypoints, and local TypeScript
  configuration.
- [ ] 2.3 Add the `apps/cli` ownership boundary without CLI behavior.
- [ ] 2.4 Document the allowed dependency graph and deferred package names.

## 3. Import Enforcement

- [ ] 3.1 Add a deterministic workspace package scanner.
- [ ] 3.2 Reject relative imports that cross package boundaries.
- [ ] 3.3 Reject undeclared or disallowed workspace dependencies.
- [ ] 3.4 Add the checker to the root `validate` command.
- [ ] 3.5 Add focused tests for the dependency policy.

## 4. Verification and Review

- [ ] 4.1 Run `bun install --frozen-lockfile`.
- [ ] 4.2 Run `bun run check:layers` and `bun run validate`.
- [ ] 4.3 Run OpenSpec strict validation.
- [ ] 4.4 Exercise one deliberate illegal import and confirm non-zero exit.
- [ ] 4.5 Read back the PR and record AI review findings and resolution.

## 5. Final Gate

- [ ] 5.1 Update the PR body with commands, results, deferred work, and
  verification evidence.
- [ ] 5.2 Confirm every acceptance criterion in #3 has evidence.
