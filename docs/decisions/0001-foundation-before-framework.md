# ADR 0001: Build the Foundation Before Selecting an Agent Framework

## Status

Accepted.

## Context

The evaluation system needs an agent loop, model access, tools, evidence
collection, and durable state. Those requirements make an Agent framework
attractive, but the system also needs a stable measurement protocol that can be
consumed by benchmark runners and retained across provider or framework
changes.

Selecting a framework before defining the repository layers would let framework
types leak into persisted contracts and domain rules. It would also make the
directory structure a consequence of the framework instead of the measurement
model.

## Decision

Build the foundation in this order:

1. Repository boundaries and dependency direction.
2. Package, build, test, formatting, and schema validation baseline.
3. Versioned measurement and runtime contracts.
4. Pure domain validation and policy logic.
5. Runtime ports and a minimal framework-neutral agent loop.
6. A time-boxed framework comparison against the frozen ports.
7. Provider and benchmark adapters.

No Agent framework may be imported by `protocol`, `domain`, or persisted
schemas. Framework evaluation is deferred until there is an executable baseline
for the same small workflow.

## Consequences

- More foundational work is required before an end-to-end model call.
- Protocol and domain tests can run without network access or a framework.
- A framework can be replaced without invalidating measurement artifacts.
- Runtime code must define its own small contracts before a framework is
  considered.
