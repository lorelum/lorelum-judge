# Lorelum Judge

Lorelum Judge is an independently consumable evaluation agent for software
engineering work. It owns task contracts, rubric authoring, evidence collection,
measurement, calibration, and gate decisions.

The public protocol is versioned independently from model providers, agent
frameworks, and benchmark runners.

## Packages

| Directory | Package | Responsibility |
| --- | --- | --- |
| `packages/protocol` | `@lorelum/judge-protocol` | Canonical primitives and versioned contracts |
| `packages/runtime` | `@lorelum/judge-runtime` | Framework-neutral agent runtime and ports |
| `packages/judge` | `@lorelum/judge` | Domain rules and measurement workflows |
| `packages/workflow` | `@lorelum/judge-workflow` | Planning, implementation, revision, and delivery |
| `packages/testing` | `@lorelum/judge-testing` | Deterministic consumer test kit |
| `packages/adapters` | `@lorelum/judge-adapters` | Provider and environment adapters |
| `apps/cli` | `@lorelum/judge-cli` | Command-line application |

## Status

Foundation only. APIs are intentionally unstable until the measurement
contracts and runtime ports are frozen.

## Development

```sh
bun install
bun run validate
```

## Repository boundaries

The implementation in this repository follows the layer rules documented in
[`docs/architecture/repository-layout.md`](docs/architecture/repository-layout.md).
Agent frameworks are not part of the foundation and cannot leak into protocol
or domain code.
