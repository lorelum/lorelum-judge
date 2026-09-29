# Foundation Review Guide

This guide lets a reviewer with no chat context inspect whether the foundation
is coherent, reproducible, and safe to build on.

## Review Scope

Review the repository baseline, package boundaries, runtime contracts, and
conformance behavior. Do not treat this as a review of rubric quality,
calibration accuracy, or engineering-workflow correctness; those layers are not
implemented here.

## Review Path

1. Read `design-rationale.md`.
2. Read `agent-framework-survey.md`.
3. Read `directory-survey.md`.
4. Inspect `docs/architecture/repository-layout.md`.
5. Inspect `docs/decisions/0001-foundation-before-framework.md` and
   `docs/decisions/0002-package-boundaries.md`.
6. Run the commands below.

## Local Verification

Run from a clean checkout of the stacked change being reviewed:

```sh
bun install --frozen-lockfile
bun run validate
```

Expected result:

- install completes from the committed lockfile;
- formatting/lint, repository baseline, import layers, typecheck, tests, and
  package builds all pass;
- `bun run check:layers` prints
  `Workspace package dependencies are valid.`;
- the conformance test completes without network or provider credentials.

Run the runtime conformance report directly:

```sh
bun -e 'import { referenceRuntime } from "./packages/runtime/src/index.ts"; import { runRuntimeConformance } from "./packages/testing/src/index.ts"; const report = await runRuntimeConformance(referenceRuntime); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exit(1);'
```

Expected cases:

- text response;
- tool call round trip;
- structured output;
- cancellation;
- tool cancellation;
- pause and resume;
- step checkpoint;
- missing resume state;
- model failure;
- environment failure;
- tool failure;
- unknown tool;
- empty tool call list.

Run OpenSpec strict validation for each foundation change:

```sh
openspec validate bootstrap-repository-foundation --type change --strict
openspec validate workspace-package-boundaries --type change --strict
openspec validate runtime-ports-conformance --type change --strict
```

## Structural Checks

### Package direction

Inspect `scripts/check-layers.ts` and confirm it rejects:

- a relative import that crosses a package boundary;
- an undeclared workspace dependency;
- a reverse dependency, such as protocol importing runtime;
- a production package importing `@lorelum/judge-testing`.

### Runtime neutrality

Inspect `packages/runtime/src` and confirm it contains no import of:

- an Agent framework;
- a provider SDK;
- a benchmark fixture or task-specific judge implementation.

### State and recovery

Inspect `packages/runtime/src/run.ts` and
`packages/runtime/src/reference-runtime.ts`. Confirm:

- run state, events, and steps are JSON-compatible;
- pause, resume, failure, cancellation, and completion are distinct;
- failures distinguish environment, model, tool, and protocol errors;
- completed steps are persisted before the loop continues;
- the runtime accepts an `AbortSignal`.

### Directory discipline

Confirm that:

- `apps/` contains an application boundary, not domain logic;
- `packages/protocol`, `judge`, and `workflow` are empty ownership boundaries
  with READMEs, not fake implementations;
- `packages/testing` is a private test kit, not a production dependency;
- no `runtime-*` or `provider-*` package exists without a real implementation.

## Reviewer Questions

1. Can a fresh clone install and validate using only repository evidence?
2. Can a package violate the dependency direction without CI catching it?
3. Can a framework SDK type leak into protocol or persisted records?
4. Can a run resume from a persisted step without using framework state?
5. Are cancellation, pause, failure, and completion distinguishable?
6. Does the repository claim measurement correctness that it has not yet
   implemented?
7. Are deferred packages and capabilities explicitly named instead of implied?

## Failure Conditions

The foundation should be rejected for this review if any of the following is
true:

- a fresh clone cannot run the documented validation;
- a forbidden dependency or cross-package relative import passes the layer
  check;
- runtime behavior depends on a real model, provider key, or network;
- framework SDK types appear in protocol or serialized runtime state;
- pause, resume, cancellation, and failure are collapsed into one status;
- an empty package is presented as a completed implementation;
- the repository claims scoring reliability without #6 through #10.

## Deferred Work

The following work is intentionally outside this foundation review:

- measurement contracts and identity (#6);
- evidence and prompt projection (#7);
- rubric authoring (#8);
- calibration and gate (#9);
- legacy judge migration (#10);
- engineering workflow (#11).

The next review should start only after the relevant measurement contract is
proposed, not by inferring it from the runtime.
