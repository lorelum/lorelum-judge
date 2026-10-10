## Why

The repository now has a reproducible root workspace, but package ownership and
allowed dependency directions are not yet executable. Without a guard, a later
change can introduce a relative import across package boundaries, an undeclared
workspace dependency, or a reverse dependency without a review signal.

This change implements the package-boundary contract required by #3.

## What Changes

- Add the core workspace packages that own protocol, runtime, judge, workflow,
  testing, and adapter boundaries.
- Add a public entrypoint and local build/typecheck configuration for each
  package.
- Add an import-boundary check to the root validation command.
- Document why framework runtime and provider-specific packages are deferred
  until a real implementation exists.

## Capabilities

### New Capabilities

- `workspace-package-boundaries`: defines package ownership, allowed dependency
  edges, public entrypoints, and executable import checks.

### Modified Capabilities

None.

## Impact

- `packages/*` and `apps/cli` manifests and source entrypoints.
- `scripts/check-layers.ts`.
- Root validation scripts and lockfile.
- Architecture documentation and package READMEs.

No measurement schema, runtime behavior, provider SDK, or benchmark contract is
implemented by this change.
