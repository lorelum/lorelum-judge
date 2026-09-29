## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #2 owns only the reproducible repository baseline.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with the repository's OpenSpec validation path or,
  before tooling exists, a documented structural check.
- [ ] 1.4 Create the initial PR with OpenSpec artifacts and process constraints
  only.

## 2. Root Workspace and Tooling

- [ ] 2.1 Add the private root workspace manifest and pinned Bun version.
- [ ] 2.2 Add TypeScript and formatting or lint configuration.
- [ ] 2.3 Add `check`, `typecheck`, `test`, `build`, and `validate` entry points.
- [ ] 2.4 Add the lockfile and ignore rules for generated or environment files.

## 3. Governance and Collaboration

- [ ] 3.1 Add `AGENTS.md` with the issue, OpenSpec, PR, and verification gates.
- [ ] 3.2 Add `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE`.
- [ ] 3.3 Add issue and PR templates based on the repository's collaboration
  language and review requirements.
- [ ] 3.4 Add the CI workflow using the same install and validation commands as
  local development.

## 4. Verification

- [ ] 4.1 Run `bun install --frozen-lockfile`.
- [ ] 4.2 Run every command reachable from `bun run validate`.
- [ ] 4.3 Read back the issue and PR rendering and confirm headings, lists,
  checkboxes, and code fences survived.
- [ ] 4.4 Confirm the diff contains no product package or historical seed
  migration.

## 5. Final Gate

- [ ] 5.1 Update the PR body with verbatim commands, results, deferred work, and
  AI-assistance disclosure.
- [ ] 5.2 Confirm every acceptance criterion in #2 has evidence or an explicit
  unresolved reason.
