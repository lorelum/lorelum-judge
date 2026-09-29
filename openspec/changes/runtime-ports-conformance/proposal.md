## Why

The runtime package currently owns a boundary but no contract. If framework or
provider types enter the first implementation, later runtime replacements will
require protocol or judge changes.

This change implements the framework-neutral runtime required by #4.

## What Changes

- Define model, tool, execution, storage, clock, and telemetry ports.
- Define serializable step, event, state, run, cancellation, and failure
  contracts.
- Implement a reference runtime loop and resume behavior.
- Add deterministic test doubles and a reusable conformance suite.
- Run the same conformance contract against the reference runtime.

## Capabilities

### New Capabilities

- `framework-neutral-runtime-conformance`: defines the runtime ports, state
  transitions, deterministic behavior, and conformance gate.

### Modified Capabilities

None.

## Impact

- `packages/runtime/src/**`
- `packages/testing/src/**`
- Runtime and conformance tests
- No protocol, judge, workflow, provider, framework, or benchmark semantics.
