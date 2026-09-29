# ADR 0001: Build the Framework-Neutral Foundation Before Selecting an Agent Framework

## Status

Accepted for the runtime-conformance change.

## Context

The evaluation system needs an agent loop, model access, tools, evidence
collection, durable state, and later an implementation workflow. Agent
frameworks already solve parts of this, but their run, session, and memory types
must not become the measurement identity or persisted judge contract.

Selecting a framework before defining the repository layers would let framework
types leak into protocol, judge domain rules, or persisted artifacts and make
the directory structure a consequence of the framework rather than the
measurement model.

## Decision

Build the foundation in this order:

1. Repository, package, build, test, and import boundaries.
2. Framework-neutral runtime ports, run state, events, cancellation, pause,
   resume, and conformance behavior.
3. Versioned protocol and measurement contracts.
4. Pure judge domain validation and policy logic.
5. Runtime and provider adapters behind the frozen ports.
6. A time-boxed framework comparison against the same conformance suite.

No Agent framework may be imported by protocol, judge domain rules, or
persisted schemas. Framework evaluation starts only after a reference runtime
passes the framework-neutral conformance suite.

## Consequences

- More foundational work is required before a real model call.
- Protocol and judge tests can run without network access or a framework.
- A framework can be replaced without invalidating measurement artifacts.
- Runtime code owns its small contracts before a framework is considered.
- The first framework adapter must prove compatibility by passing the public
  conformance suite, not by providing its own self-selected tests.
