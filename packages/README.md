# Packages

This directory contains independently releasable library packages for the
evaluation agent.

The planned package boundaries are:

```text
protocol/   @lorelum/judge-protocol
runtime/    @lorelum/judge-runtime
judge/      @lorelum/judge
workflow/   @lorelum/judge-workflow
testing/    @lorelum/judge-testing
adapters/   provider and environment implementations
```

The boundaries are reserved now because protocol consumers, runtime consumers,
provider adapters, and test helpers do not necessarily share the same release
cycle. A package directory is filled only when its public contract and
compatibility policy are stable.

Rules:

- `protocol` depends on no other Lorelum package and contains no runtime.
- `runtime` depends on `protocol` but never on a provider SDK or agent
  framework.
- `judge` depends on `protocol` and `runtime`; it owns domain rules and
  measurement workflows.
- `workflow` depends on `protocol`, `runtime`, and `judge`; it owns planning,
  implementation, revision, delivery, and long-running orchestration.
- `testing` depends on public packages and is safe for consumers to import.
- provider-specific adapters live in their own packages when their SDK or
  release requirements differ.
- framework-specific runtimes use `packages/runtime-*`.
- concrete provider SDKs use `packages/provider-*`.
