## Context

#3 establishes package boundaries and an import guard. The runtime package is
currently a no-op export. The next foundation step is a stable runtime contract
that can run without a framework, network, provider key, or model.

## Goals / Non-Goals

**Goals:**

- Keep runtime types independent from Agent framework and provider SDK types.
- Make a run deterministic under scripted ports.
- Persist enough state to resume and to explain an incomplete run.
- Make cancellation an explicit terminal state rather than a generic failure.
- Provide reusable conformance tests for future `runtime-*` implementations.

**Non-Goals:**

- Do not define measurement, rubric, verdict, calibration, or gate behavior.
- Do not choose or install an Agent framework.
- Do not create a `runtime-*` adapter package.
- Do not define provider authentication, transport, or model catalogs.
- Do not persist framework-native objects.

## Decisions

### Ports are the only external dependency surface

The runtime receives `ModelPort`, `ToolRegistry`, `ExecutionPort`,
`RunStore`, `ClockPort`, and `TelemetryPort`. The reference runtime invokes
these ports and never imports a concrete implementation.

### State and events are serializable

Messages, tool calls, tool results, errors, state, and events use JSON-compatible
values plus ISO timestamps. No framework object is stored in `RunState` or
`RunEvent`.

### One runtime interface, one reference implementation

`AgentRuntime.run()` is the public interface. `ReferenceRuntime` is the first
implementation and is tested through the same conformance suite that future
framework adapters must pass.

### Resume is explicit

The reference runtime saves state after each step. When the step budget is
reached, it returns `paused` rather than claiming completion or failure.
`resume()` loads a persisted state and continues from the next step. A missing
or non-resumable state returns a structured error rather than silently starting
new work.

### Failure categories are structured

Runtime errors use `environment_error`, `model_error`, `tool_error`, and
`protocol_error`. Tool-not-found is a protocol error; a thrown tool execution is
a tool error; a thrown model adapter is a model error; cancellation is a
separate terminal state.

### Conformance is a consumer package

The deterministic test doubles and conformance runner live in
`@lorelum/judge-testing`, which can depend on runtime. Production packages do
not depend on the test kit. Root tests invoke the runner against the reference
runtime.

## Risks / Trade-offs

- [An overly rich event model could become a second protocol] -> Keep events
  minimal and runtime-local; versioning and cross-boundary schemas remain
  protocol work.
- [A single runtime loop could encode framework assumptions] -> Keep ports
  small and required tests independent of framework concepts.
- [Resume could duplicate side effects] -> Persist state after each step and
  require implementations to use stable step indices and tool call IDs.
- [Conformance could only prove a test double] -> The suite is written against
  the public `AgentRuntime` interface so the same cases can run against future
  adapters without changing runtime or judge code.

## Migration Plan

1. Add the OpenSpec change and initial PR.
2. Define runtime ports and serializable contracts.
3. Implement the reference runtime and failure handling.
4. Add deterministic test doubles and the conformance runner.
5. Run conformance, typecheck, build, and the full repository gate.

Rollback removes runtime implementation and test helpers; no protocol or
workflow behavior depends on them yet.

## Open Questions

None that block this change.
