## Context

`workspace-package-boundaries` reserved `apps/cli` and `packages/adapters` as
stable ownership boundaries before any behavior existed. Both entrypoints are
still `export {};` and nothing imports them. The repository's primary
consumption model is package `import`, so a CLI application boundary has no
current purpose, and provider-neutral adapters have no implementation to own.

## Goals / Non-Goals

**Goals:**

- Remove both empty boundaries and every reference to them.
- Keep the layer check, baseline check, and tests consistent with the smaller
  workspace.
- Keep the `runtime-*` and `provider-*` naming reservation.

**Non-Goals:**

- Do not change protocol, runtime, judge, workflow, or testing behavior.
- Do not decide whether `workflow` stays in this repository; #11 owns that.
- Do not add a replacement package for adapters or CLI.

## Decisions

### Remove, do not deprecate

Neither package is published (`private: true`) and neither has a consumer or
export. Delete them outright and update all references; no alias or stub is
kept.

### Drop the `apps/*` workspace pattern

With `apps/cli` gone, `apps/` is empty. Remove it from the root `workspaces`,
from `tsconfig.json` includes, and from the baseline check that currently
requires it. A future application introduces the pattern again in its own
change.

### Adapters return when a real implementation exists

Provider, storage, and execution adapters are introduced as `provider-*` or
`runtime-*` packages, or as a new owned package, when a concrete implementation
and consumer exist. The dependency policy for those names is unchanged.

## Risks / Trade-offs

- [Removing a documented boundary could lose the intended ownership of
  normalization, storage, and execution] -> The ownership text stays in
  `docs/architecture/repository-layout.md` as deferred scope, not as a package.
- [Stale references could break the layer check or baseline] -> Run
  `bun run validate` and grep for `judge-cli`, `judge-adapters`, and `apps/`.

## Migration Plan

1. Create issue #22, this OpenSpec change, and the initial PR with OpenSpec
   artifacts only.
2. Delete `apps/` and `packages/adapters/` and update the references listed in
   the proposal.
3. Regenerate `bun.lock`, run `bun run validate`, and strict-validate this
   change.

Rollback restores the two directories and their references from git history.

## Open Questions

None that block this change.
