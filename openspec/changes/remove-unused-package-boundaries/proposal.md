## Why

`apps/cli` and `packages/adapters` were created by `workspace-package-boundaries`
(#3) as ownership boundaries, but both still export only `{}`. The repository is
consumed by `import`, there is no command to expose, and no provider, storage, or
execution adapter exists. This conflicts with the rule that empty packages are
not created without a real implementation and consumer.

This change implements the cleanup required by #22.

## What Changes

- **BREAKING** Remove `apps/cli` (`@lorelum/judge-cli`) and the `apps/*`
  workspace pattern.
- **BREAKING** Remove `packages/adapters` (`@lorelum/judge-adapters`).
- Remove the `cli` and `adapters` edges from the dependency graph, the layer
  check policy, the baseline check, tests, lockfile, and documentation.
- Keep the `runtime-*` and `provider-*` naming reservation. A real provider,
  storage, or execution implementation introduces its own package through a
  later change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-package-boundaries`: the core package set and dependency graph no
  longer include `adapters` or `cli`.

## Impact

- `apps/`, `packages/adapters/`, `bun.lock`, root `package.json`,
  `tsconfig.json`.
- `scripts/check-layers.ts`, `scripts/repository-baseline.ts`,
  `tests/workspace-boundaries.test.ts`.
- `AGENTS.md`, `README.md`, `docs/architecture/repository-layout.md`,
  `docs/decisions/0002-package-boundaries.md`.

No protocol, runtime, judge, workflow, or testing behavior changes. Neither
removed package has a consumer or exported symbol.
