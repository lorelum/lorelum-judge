# Framework-Neutral Runtime Conformance Specification

## Purpose

Define a runtime that can execute an agentic step cycle without depending on a
specific Agent framework, provider SDK, model, or network, and define the
conformance behavior required of every runtime implementation.

## ADDED Requirements

### Requirement: Runtime exposes framework-neutral ports

The runtime MUST define ports for model generation, tool lookup and execution,
execution, persistence, clock access, and telemetry. Public runtime contracts
MUST NOT import or persist Agent framework or provider SDK types.

#### Scenario: Reference runtime uses only ports

- **WHEN** the reference runtime executes a run
- **THEN** all model, tool, persistence, time, and telemetry interaction occurs
  through the declared ports

#### Scenario: Framework types do not enter state

- **WHEN** a runtime implementation serializes a run
- **THEN** the serialized state and events contain JSON-compatible values only

### Requirement: Runtime state and events are serializable

The runtime MUST expose a versioned `RuntimeRun` record containing run id,
status, step index, max steps, ordered step records, messages, optional output
or error, timestamps, and telemetry event references. Events MUST distinguish
run start, model request and response, tool start and completion, step
completion, pause, and terminal state. The status set MUST include `running`,
`paused`, `completed`, `failed`, and `cancelled`.

#### Scenario: Successful text run is inspectable

- **WHEN** a scripted model returns a text response
- **THEN** the run reaches `completed` and the persisted record contains the
  response, final step index, and ordered events

#### Scenario: Structured response is inspectable

- **WHEN** a scripted model returns structured output
- **THEN** the run reaches `completed` with a JSON-compatible output value

#### Scenario: Step budget pauses instead of claiming completion

- **WHEN** a run reaches its step budget with more work available
- **THEN** the run reaches `paused` and retains enough state to resume

#### Scenario: Step completion events use the completed step index

- **WHEN** a run step completes
- **THEN** `step_completed` and the terminal `run_completed` event use the
  completed step's index
- **AND** the next `model_requested` event uses the incremented run step index

### Requirement: Runtime port failures become structured failures

The runtime MUST convert storage, clock, telemetry, model, tool, and execution
port exceptions into a terminal failed run or a structured resume failure. A
port exception MUST NOT reject `run()` or `resume()`. A failed run returns
`environment_error` unless the port provided a more specific structured
failure.

#### Scenario: Store failure does not reject the run

- **WHEN** the run store throws while saving a run
- **THEN** `run()` resolves to a failed run
- **AND** the failure is classified as `environment_error`
- **AND** the returned run contains a `run_failed` event

#### Scenario: Telemetry failure does not reject the run

- **WHEN** telemetry throws while emitting an event
- **THEN** `run()` resolves to a failed run with an `environment_error`
- **AND** the returned run retains a best-effort `run_failed` event

#### Scenario: Clock failure does not reject the run

- **WHEN** the clock throws while a run is being created or updated
- **THEN** `run()` resolves to a failed run with an `environment_error`
- **AND** the returned run uses a documented fallback timestamp for the failure
  envelope

#### Scenario: Store load failure is a structured resume result

- **WHEN** the run store throws while loading a run for resume
- **THEN** `resume()` returns `ok: false` with an `environment_error`

### Requirement: Runtime executes tool calls

The runtime MUST support model responses containing one or more tool calls,
look up each call through the tool registry, execute it through the tool port,
append a tool-result message, and continue the loop until a terminal response or
step limit.

#### Scenario: Tool call round trip

- **WHEN** the model returns a tool call and the registry contains the tool
- **THEN** the tool executes, its result is persisted, and the next model
  request contains the tool result

#### Scenario: Unknown tool fails as protocol error

- **WHEN** the model returns a call for a tool that is not registered
- **THEN** the run terminates as `failed` with `protocol_error`

#### Scenario: Tool failure is distinguishable

- **WHEN** a registered tool throws during execution
- **THEN** the run terminates as `failed` with `tool_error`

### Requirement: Cancellation has explicit semantics

The runtime MUST accept an `AbortSignal`. A run cancelled before or during
execution MUST terminate as `cancelled`, not `failed` or `completed`, and MUST
persist the cancellation point.

#### Scenario: Pre-aborted run cancels

- **WHEN** `run()` receives an already-aborted signal
- **THEN** the run terminates as `cancelled` before model execution

### Requirement: Resume continues persisted state

The runtime MUST persist state after each completed step and MUST expose a
resume operation. Resume MUST load the persisted paused or running run, accept
an optional extended step budget, continue at the next step, and MUST return a
structured error when the run cannot be resumed.

#### Scenario: Resume completes a paused run

- **WHEN** a run is paused after a tool step and `resume()` is called with the
  same run id and an extended step budget
- **THEN** the model receives the persisted tool result and the run completes

#### Scenario: Missing state fails explicitly

- **WHEN** `resume()` is called for a run id that does not exist
- **THEN** it returns a structured `protocol_error` and does not create a new
  run

#### Scenario: Resume without remaining budget fails explicitly

- **WHEN** a paused run has no remaining step budget and `resume()` does not
  extend it
- **THEN** `resume()` returns `ok: false` with a `protocol_error`
- **AND** it does not return `ok: true` with the run still paused

### Requirement: Conformance is reusable across runtimes

`@lorelum/judge-testing` MUST expose deterministic model, store, clock, and
telemetry doubles plus a conformance runner whose input is an `AgentRuntime`.
The reference runtime MUST pass the suite, and future `runtime-*` packages MUST
be able to run the same suite without modifying protocol or judge semantics.

#### Scenario: Reference runtime passes conformance

- **WHEN** the conformance runner is invoked with `ReferenceRuntime`
- **THEN** text, tool, structured, cancellation, resume, and failure cases pass

#### Scenario: No network is required

- **WHEN** the conformance suite runs in CI
- **THEN** it uses only deterministic doubles and performs no model or provider
  network call
