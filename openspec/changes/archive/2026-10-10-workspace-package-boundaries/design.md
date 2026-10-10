## Context

#2 establishes the workspace and validation baseline. Contract work should not
begin until the repository can state which package owns each concern and which
dependencies are legal.

The historical seed branch contains a similar package graph, but it also
contains product primitives and must not be copied wholesale. This change takes
only the boundary structure needed to make #4 and later contract work
independently reviewable.

## Goals / Non-Goals

**Goals:**

- Give every planned core package a stable name, owner, README, and public
  entrypoint.
- Enforce the dependency direction `protocol -> runtime -> judge -> workflow`.
- Prevent undeclared workspace dependencies and relative imports across package
  boundaries.
- Keep framework runtime and provider SDK implementations in separate future
  packages using `runtime-*` and `provider-*` names.

**Non-Goals:**

- Do not define measurement, rubric, evidence, calibration, or gate types.
- Do not implement runtime ports or loops.
- Do not choose an Agent framework.
- Do not create `runtime-*` or `provider-*` packages without a real
  implementation.

## Decisions

### Core packages are created now, integration packages later

Create `protocol`, `runtime`, `judge`, `workflow`, `testing`, `adapters`, and
`apps/cli` as the stable ownership boundaries. Their source entrypoints remain
empty until the owning change lands. Create framework-specific and
provider-specific packages only when their implementation and dependency graph
are real.

### Package exports point to source under Bun and declaration types

Each private package exposes `src/index.ts` for Bun and TypeScript consumers and
reserves `dist/index.js` for built imports. This keeps fresh-clone typechecking
independent of stale build output while preserving a path to generated
artifacts.

### Import checks read the actual workspace graph

`scripts/check-layers.ts` discovers workspace packages, scans `src/**/*.ts`,
parses import specifiers, and rejects:

- a relative import that resolves into another package;
- a workspace package import without a `workspace:*` declaration;
- a package dependency not allowed by the declared graph;
- a workspace package with no dependency policy.

The check is deterministic, network-free, and included in `bun run validate`.

### Testing remains a separate private package

`testing` is a source boundary for future deterministic helpers and is allowed
to depend on protocol, runtime, and judge. Production packages must not depend
on it; the import guard enforces this direction.

## Risks / Trade-offs

- [Empty packages could look like architecture by declaration] -> Keep only
  ownership READMEs and no-op entrypoints; add behavior only in owning changes.
- [A source export could leak into published artifacts] -> Packages remain
  `private` until a release policy changes the export map and verifies built
  artifacts.
- [A static scanner can miss dynamic imports] -> Cover static imports with the
  parser, fail closed on undeclared workspace imports, and keep package imports
  explicitly declared.
- [The guard could block legitimate local imports] -> Relative imports are
  allowed inside one package and rejected only when they cross a package root.

## Migration Plan

1. Create the issue, OpenSpec change, and initial PR containing OpenSpec only.
2. Add core package manifests, READMEs, entrypoints, and local TypeScript
   configuration.
3. Add and test the import-boundary checker.
4. Document the dependency graph and deferred integration packages.
5. Run the root validation gate and record a deliberate failing import sample.

Rollback removes the new packages and the layer check; no protocol or runtime
behavior depends on this change yet.

## Open Questions

None that block this change.
