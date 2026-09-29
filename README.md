# Lorelum Judge

Lorelum Judge is an independently consumable evaluation agent for software
engineering work. It owns task contracts, rubric authoring, evidence collection,
measurement, calibration, and gate decisions.

The repository is currently in foundation development. Protocol,
measurement-contract, runtime, and workflow packages are added only through
their own issues and OpenSpec changes.

## Package Boundaries

| Directory | Package | Responsibility |
| --- | --- | --- |
| `packages/protocol` | `@lorelum/judge-protocol` | Versioned cross-boundary contracts |
| `packages/runtime` | `@lorelum/judge-runtime` | Framework-neutral runtime and ports |
| `packages/judge` | `@lorelum/judge` | Judge domain and measurement workflows |
| `packages/workflow` | `@lorelum/judge-workflow` | Planning, implementation, revision, and delivery |
| `packages/testing` | `@lorelum/judge-testing` | Deterministic consumer test kit |
| `packages/adapters` | `@lorelum/judge-adapters` | Provider-neutral environment adapters |
| `apps/cli` | `@lorelum/judge-cli` | Command-line application boundary |

The dependency graph and import rules are documented in
`docs/architecture/repository-layout.md` and enforced by `bun run check:layers`.

## Architecture Review

Start with `docs/architecture/README.md` for the framework survey, directory
survey, design rationale, and the external review checklist.

## Development

```sh
bun install --frozen-lockfile
bun run validate
```

The local validation command is also the CI gate. Run it before opening a pull
request and record the exact commands and results in the PR body.

## Contribution Gate

Contract-class changes require a linked issue and an OpenSpec change before
implementation. See `CONTRIBUTING.md` and `AGENTS.md` for the repository flow.
Independent evaluation agent for software engineering quality
