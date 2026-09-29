# ADR 0002: Package Boundaries for Runtime, Workflow, Testing, and Providers

## Status

Accepted for the workspace-boundary change.

## Context

The repository needs a TypeScript/Bun runtime, a framework-neutral measurement
protocol, one or more Agent runtime implementations, a long-running engineering
workflow, a deterministic test kit, and provider-specific SDKs.

Keeping every concern in one package would mix dependency weight and release
cadence. Creating every possible package immediately would add unused
abstractions.

## Decision

### Runtime remains TypeScript and Bun

Python frameworks remain architecture references. A Python service boundary is
introduced only if a later runtime comparison proves that TypeScript cannot
satisfy a concrete requirement.

### Framework runtimes use `packages/runtime-*`

The neutral runtime lives in `packages/runtime`. A framework implementation is
added only when it is actually evaluated or supported. The framework SDK must
not enter protocol, judge domain rules, or persisted artifacts.

Alternative rejected: put adapters in `packages/adapters`. This would make one
package carry every framework dependency and release cadence.

### Revision workflow is a separate package

Planning, implementation, revision, delivery, stop conditions, and budget
enforcement live in `packages/workflow`. The judge reports findings and
decisions; the workflow acts on them.

Alternative rejected: put revision workflow in `packages/judge`. This would
entangle measurement semantics with implementation control flow and make
independent evolution harder.

### Testing starts as a private workspace package

`packages/testing` owns deterministic helpers and assertions. It stays private
until its API and compatibility policy stabilize. Production packages must not
depend on it.

Alternative rejected: expose tests through an umbrella subpath. This obscures
the production dependency graph and makes test helpers look like a stable
public API before consumers exist.

### Provider adapters split by SDK

`packages/adapters` owns provider-neutral infrastructure. Concrete SDKs use
packages such as `provider-openai` and `provider-anthropic`, created when a real
integration exists.

Alternative rejected: start with one package per provider or one package for
all providers. One package per provider before implementation creates unused
packages; a single all-provider package forces unrelated SDK dependencies and
release cadence into every installation.

## Consequences

- The dependency graph is explicit and checked by `scripts/check-layers.ts`.
- Framework and provider dependencies stay outside measurement contracts.
- Integration packages are delayed until their implementation can be tested.
- Workflow and testing can evolve without changing measurement semantics.
- Every new core package has a README and a defined owner before behavior lands.
