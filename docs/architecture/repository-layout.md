# Repository Layout

## Purpose

Lorelum Judge is an evaluation agent. It consumes task and repository context,
collects evidence, applies a versioned measurement policy, and produces a
decision that can be reproduced or invalidated.

The repository is not a benchmark suite. Benchmark repositories provide tasks,
fixtures, candidate workspaces, and execution environments; they consume the
public contracts defined here.

## Dependency Graph

```text
protocol -> no workspace package
runtime  -> protocol
judge    -> protocol, runtime
workflow -> protocol, runtime, judge
testing  -> protocol, runtime, judge
```

`scripts/check-layers.ts` validates these edges, requires declared
`workspace:*` dependencies, and rejects relative imports that cross package
boundaries.

Framework implementations use `packages/runtime-*` and may depend on protocol
and runtime. Concrete provider SDKs use `packages/provider-*` and may depend on
protocol and runtime. Neither package type may leak SDK types into public
contracts.

## Package Responsibilities

### Protocol

Versioned records that cross a process, package, repository, or persistence
boundary. The package owns canonical serialization and identity primitives, not
network calls or runtime state.

### Runtime

Framework-neutral steps, events, state, cancellation, tool dispatch, and ports
for model, execution, storage, clock, and telemetry access. It does not define
rubric, verdict, calibration, or gate semantics.

### Judge

Pure domain rules and workflows for task framing, rubric authoring, evidence
collection, judgment, calibration, and gate decisions. It consumes protocol and
runtime through their public APIs.

### Workflow

Planning, implementation, revision, delivery, stop conditions, budget
enforcement, and long-running orchestration. It consumes judge decisions and
does not redefine measurement semantics.

### Testing

Deterministic consumer helpers. It is a separate private package so production
packages cannot acquire a hidden runtime dependency on test fixtures.

## Initial Build Order

1. Repository bootstrap and package boundaries.
2. Framework-neutral runtime ports and conformance behavior.
3. Protocol foundation and versioned contract artifacts.
4. Judge domain rules, rubric compilation, evidence, calibration, and gate.
5. Engineering workflow and deterministic test kit.
6. Provider, execution, storage, and benchmark adapters.
7. End-to-end usage examples.

## Framework Rule

No Agent framework is selected by the foundation. The runtime must first define
its own ports and deterministic conformance checks. A framework evaluation may
replace implementation details inside a `runtime-*` package, but framework types
must not enter protocol, judge domain rules, or persisted artifacts.
