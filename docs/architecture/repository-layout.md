# Repository Layout

## Purpose

This repository is an evaluation agent, not a benchmark suite. It turns a task
and repository snapshot into a scoped measurement, collects evidence, applies a
decision policy, and retains enough identity to reproduce or invalidate that
measurement.

Benchmark repositories provide tasks, fixtures, candidate workspaces, and
execution environments. They consume these packages through public contracts.
They do not define the evaluation agent's domain model.

## Workspace Boundaries

```text
apps/
  cli/          @lorelum/judge-cli

packages/
  protocol/     @lorelum/judge-protocol
  runtime/      @lorelum/judge-runtime
  judge/        @lorelum/judge
  workflow/     @lorelum/judge-workflow
  testing/      @lorelum/judge-testing
  adapters/     @lorelum/judge-adapters
```

Allowed package dependencies are:

```text
protocol -> none
runtime  -> protocol
judge    -> protocol, runtime
workflow -> protocol, runtime, judge
testing  -> protocol, runtime, judge
adapters -> protocol, runtime
cli      -> protocol, runtime, judge, workflow, adapters
```

`scripts/check-layers.ts` validates these edges and requires workspace
dependencies to be declared in each package manifest.

Framework-specific runtime packages use `packages/runtime-*`. Concrete provider
SDK packages use `packages/provider-*`. They are created only when a real
implementation exists, but their dependency policy is already fixed.

## Package Responsibilities

### Protocol

Versioned records that cross process, package, or repository boundaries:
identity, task, context, rubric, evidence, measurement, calibration, and gate.
It contains canonical primitives and schemas only. It does not contain model
calls, runtime state, filesystem code, or provider types.

### Runtime

A framework-neutral agent runtime: steps, events, state, cancellation, tool
dispatch, and ports for model access, execution, storage, clocks, and telemetry.
It does not know about rubric, verdict, calibration, or gate semantics.

### Judge

Pure domain rules and workflows for task framing, rubric authoring, evidence
collection, judgment, calibration, and gate decisions. It consumes the protocol
and runtime through their public APIs.

### Workflow

Planning, implementation, revision, delivery, stop conditions, budget
enforcement, and long-running orchestration. It consumes judge decisions and
never redefines measurement semantics.

### Testing

Deterministic consumer helpers: scripted models, in-memory stores, deterministic
clocks, fixture builders, and contract assertions. It must not become a hidden
runtime dependency of production packages.

### Adapters

Provider and environment implementations of runtime ports. Provider SDK types
stay inside adapter packages. A provider is split into its own package when its
SDK, authentication model, or release cadence requires one.

### CLI

Command parsing, configuration assembly, workflow invocation, report rendering,
and process exit behavior. It contains no new measurement semantics.

## Repository Layout

```text
.
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── workflows/
│   ├── dependabot.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── apps/
│   └── cli/
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── guides/
│   └── reference/
├── examples/
├── packages/
│   ├── adapters/
│   ├── judge/
│   ├── protocol/
│   ├── runtime/
│   ├── testing/
│   └── workflow/
├── prompts/
├── schemas/
├── scripts/
└── tests/
    ├── contract/
    ├── integration/
    └── fixtures/
```

Package-local tests live beside their package. The root `tests/` directory is
reserved for cross-package contract and integration tests.

## Dependency Direction Inside `judge`

Imports may point downward only:

```text
entrypoints -> workflows -> domain -> protocol
                         -> runtime ports
```

The domain is pure and testable without network access, a model, or an agent
framework. Workflows compose domain rules and ports. Runtime implementation
details never become persisted contract types.

## Initial Build Order

1. Protocol foundation: canonical JSON, hashes, stable IDs, errors, results.
2. Protocol artifacts: task, context, rubric, evidence, measurement,
   calibration, and gate.
3. Runtime ports and a minimal event/state/step model.
4. Domain validation for task scope, rubric, evidence, measurement, calibration,
   and gate policy.
5. Workflows and deterministic test kit.
6. Revision and delivery workflow in the separate workflow package.
7. Provider, execution, storage, and benchmark adapters.
8. CLI and public usage examples.

## Framework Rule

No Agent framework is selected at the foundation stage. The runtime first
defines its own ports and a minimal state/event contract. A framework evaluation
is allowed only after protocol and domain tests are stable.

If a framework is later adopted, it may replace implementation details inside
`packages/runtime` or `packages/adapters`. It must not become a required type in
protocol contracts, judge domain rules, or persisted artifacts.
