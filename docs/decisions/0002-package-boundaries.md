# ADR 0002: Package Boundaries for Runtime, Workflow, Testing, and Providers

## Status

Accepted.

## Context

The repository must support a TypeScript/Bun runtime, a framework-neutral
measurement protocol, one or more Agent runtime implementations, a long-running
engineering workflow, a deterministic test kit, and provider-specific SDKs.

If these concerns share one package, dependency weight, release cadence, and
framework coupling will become indistinguishable. If every possible boundary is
created immediately, the workspace gains packages without consumers.

## Decision

### Runtime remains TypeScript and Bun

Python frameworks remain architecture references. A Python service boundary is
not introduced unless a later runtime comparison demonstrates a concrete
requirement that TypeScript cannot satisfy.

### Framework runtimes use `packages/runtime-*`

The neutral runtime lives in `packages/runtime`. Framework-specific runtime
implementations use separate packages such as:

```text
packages/runtime-openai-agents
packages/runtime-langgraph
```

These packages are created only when a framework implementation is actually
evaluated or supported. A framework SDK must not enter the protocol, judge
domain rules, or persisted artifacts.

### Revision workflow is a separate package

Planning, implementation, revision, delivery, stop conditions, and budget
enforcement belong to `packages/workflow` and package
`@lorelum/judge-workflow`.

The dependency direction is:

```text
protocol <- runtime <- judge <- workflow
```

The judge reports findings and decisions. The workflow acts on them.

### Testing starts as a private workspace package

`packages/testing` remains the source boundary for scripted models, in-memory
stores, deterministic clocks, fixtures, and assertions. It starts private and
is published separately only after its API and compatibility policy stabilize.
Production packages must not depend on it.

### Provider adapters split by SDK

`packages/adapters` contains provider-neutral infrastructure such as transport,
normalization, retry, usage, and streaming conversion.

Concrete provider SDK implementations use independent packages such as:

```text
packages/provider-openai
packages/provider-anthropic
```

Provider packages are introduced when a real SDK is integrated. A future
registry package may assemble providers, but it must not force all provider SDKs
into every installation.

## Consequences

- The package graph remains explicit and checked by `scripts/check-layers.ts`.
- Framework and provider dependencies stay outside the measurement boundary.
- The first runtime and provider packages are delayed until there is a real
  implementation to validate.
- Revision workflow can evolve independently from measurement semantics.
- Changesets and release automation will gain more packages over time, but each
  new package has an independent dependency and compatibility reason.
