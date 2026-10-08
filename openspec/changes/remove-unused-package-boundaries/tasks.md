## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #22 owns only removal of `apps/cli` and
  `packages/adapters`.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [x] 1.4 Create the change PR with OpenSpec artifacts before implementation
  and continue implementation on the same branch.

## 2. Removal

- [x] 2.1 Delete `apps/` and `packages/adapters/`.
- [x] 2.2 Remove the `apps/*` workspace, the cli and adapters build filters,
  and the `apps/**` tsconfig include.
- [x] 2.3 Remove the cli and adapters entries from `scripts/check-layers.ts`,
  the `apps/*` requirement from `scripts/repository-baseline.ts`, and the cli
  assertion from `tests/workspace-boundaries.test.ts`.
- [x] 2.4 Regenerate `bun.lock`.

## 3. Documentation

- [x] 3.1 Update `AGENTS.md` dependency graph, ownership table, and foundation
  status.
- [x] 3.2 Update `README.md`, `docs/architecture/repository-layout.md`, and
  `docs/decisions/0002-package-boundaries.md`.

## 4. Verification and Review

- [x] 4.1 Run `bun install --frozen-lockfile`.
- [x] 4.2 Run `bun run validate`.
- [x] 4.3 Run `openspec validate remove-unused-package-boundaries --type change --strict`.
- [x] 4.4 Confirm no remaining reference to `judge-cli`, `judge-adapters`, or
  `apps/` outside OpenSpec change records.
- [ ] 4.5 Read back the PR and record AI review findings and resolution.

## 5. Final Gate

- [ ] 5.1 Update the PR body with commands, results, deferred work, and
  verification evidence.
- [ ] 5.2 Confirm every acceptance criterion in #22 has evidence.
