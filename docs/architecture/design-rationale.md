# Design Rationale: From Minimal Repository to Useful Foundation

Status: accepted foundation rationale. It describes why the current layers
exist and what is deliberately deferred.

## Problem

The previous JudgeAgent grew as several task-specific sidecars. Rubric,
scoring, prompt projection, provider/model identity, thresholds, and
calibration were mixed in the same implementations. Replacing a model or
changing an evidence shape could silently change the meaning of a result.

The repository therefore needs a stable measurement contract, a replaceable
runtime, a deterministic test surface, and a workflow that can consume judge
results without becoming the judge.

## Design Constraints

- Benchmark repositories own tasks and fixtures; this repository owns the
  evaluation agent.
- Model providers and Agent frameworks must be replaceable.
- Measurement identity must survive provider, prompt, and runtime changes.
- Runtime tests must run without network, credentials, or a real model.
- Framework SDK types must not enter protocol or persisted artifacts.
- A workflow may act on judgments but must not redefine measurement semantics.
- A package boundary must have a real owner and eventually a real consumer.

## Build Order

### Stage 0: Minimal Main

The remote repository starts with only a README. A historical seed branch
contains investigation, but it is reference material, not a migration source.

This is important: the new repository must be reconstructible from its own
issues, OpenSpec changes, commits, and tests.

### Stage 1: Reproducible Repository Baseline

The bootstrap layer adds:

- one Bun workspace and lockfile;
- exact local/CI tool versions;
- format, typecheck, test, build, and aggregate validation commands;
- governance, security, issue, and PR templates;
- an issue -> OpenSpec -> PR gate for contract-class changes.

This stage prevents later work from depending on an undocumented local setup.

### Stage 2: Executable Package Boundaries

The workspace then defines:

```text
protocol -> runtime -> judge -> workflow
```

`testing`, `adapters`, and `cli` are separate consumers. The import guard
rejects:

- relative imports that cross package boundaries;
- undeclared workspace dependencies;
- reverse dependencies;
- packages without a policy.

This stage prevents framework, provider, benchmark, or workflow concerns from
leaking into the measurement core.

### Stage 3: Framework-Neutral Runtime

The runtime defines:

- model, tool, execution, storage, clock, and telemetry ports;
- JSON-compatible run, step, event, state, pause, resume, cancel, and failure
  records;
- a reference runtime;
- deterministic test doubles;
- a reusable conformance suite over the public `AgentRuntime` interface.

This stage makes framework selection an implementation choice rather than a
repository-wide architectural decision.

### Stage 4: Measurement Layer

Not implemented yet. Issues #6 through #10 will define:

- measurement contracts and identity;
- evidence and prompt projection;
- task-grounded rubric authoring;
- calibration and gate behavior;
- legacy judge migration.

### Stage 5: Engineering Workflow

Issue #11 will define:

- task framing and context;
- planning and implementation;
- independent evidence collection;
- structured decisions and revision loops;
- delivery authorization and long-term evolution.

## Package Responsibilities

### Protocol

Versioned records that cross a process, package, repository, or persistence
boundary. It owns canonical serialization and identity primitives, not model
calls or filesystem execution.

### Runtime

A replaceable execution loop and ports. It owns run/step/event/cancellation
semantics, but not rubric, evidence ownership, calibration, or gate decisions.

### Judge

Pure domain rules and workflows for task framing, rubric authoring, evidence,
measurement, calibration, and gate decisions. It consumes protocol and runtime
through their public APIs.

### Workflow

Planning, implementation, revision, delivery, stop conditions, budget
enforcement, and long-running orchestration. It consumes judge decisions and
does not define them.

### Testing

Scripted models, in-memory stores, deterministic clocks, telemetry recorders,
fixture builders, and conformance assertions. It stays private until its API
stabilizes, and production packages must not depend on it.

### Adapters

Provider-neutral transport, normalization, retry, usage, streaming, storage,
and execution infrastructure. Concrete provider SDKs use separate
`provider-*` packages when an implementation exists.

### CLI

Command parsing, configuration assembly, workflow invocation, rendering, and
process exit behavior. It contains no new measurement semantics.

## Why These Boundaries

### Why workflow is not inside judge

Judge answers "what is true about this candidate under a measurement policy".
Workflow answers "what should the implementation process do next". Combining
them would let revision state, budgets, and retry policy alter measurement
semantics.

### Why testing is a separate private package

Production packages need scripted models and deterministic stores for tests,
but they must not accidentally import test fixtures at runtime. A separate
private package makes the dependency visible and lets the import guard reject
production -> testing edges.

### Why framework runtimes use `runtime-*`

A framework SDK has its own dependency graph and release cadence. Keeping it in
a `runtime-*` package prevents it from becoming a transitive dependency of
every protocol, judge, or workflow consumer.

### Why providers use `provider-*`

Model providers differ in SDKs, authentication, streaming, usage, and failure
behavior. Provider-neutral infrastructure stays in `adapters`; a provider SDK
gets its own package when it has a real implementation.

### Why framework selection is delayed

The foundation must first define the port surface and the conformance behavior.
Otherwise the framework's state model becomes the repository's hidden
architecture. A framework adapter must pass the same public conformance suite
as the reference runtime.

## Invariants

- Protocol has no dependency on runtime, judge, workflow, adapters, or
  providers.
- Framework and provider SDK types do not enter protocol or persisted records.
- Runtime state is JSON-compatible and independently reproducible.
- Failure, cancellation, pause, and completion are distinct states.
- Missing evidence cannot become a zero score by default.
- Measurement identity changes invalidate old calibration.
- The workflow cannot silently redefine rubric, scale, evidence, calibration,
  or gate semantics.

## Trade-offs and Current Limits

- The foundation has more packages than a single-package prototype. This is
  justified by independent consumers and release boundaries, but it must not
  grow into empty platform packages.
- The runtime has no framework adapter yet. It is intentionally unfilled until
  the conformance suite is accepted.
- Protocol and judge packages currently expose no-op entrypoints. They are
  ownership boundaries, not completed measurement implementations.
- The repository does not yet prove rubric reliability, calibration quality,
  or end-to-end engineering delivery. Those are later issues, not hidden
  claims.

## What a Reviewer Should Be Able to Conclude

If the foundation review passes, a reviewer can conclude:

- the repository can be installed and validated from a fresh clone;
- package ownership and dependency direction are executable rules;
- runtime behavior is deterministic and framework-independent;
- framework/provider integration has a defined future location;
- measurement and workflow work can proceed without rewriting the foundation.

The reviewer should not conclude that the scoring problem is solved yet.
