# Lorelum Judge

Lorelum Judge is an independently consumable evaluation agent for software
engineering work. It owns task contracts, rubric authoring, evidence collection,
measurement, calibration, and gate decisions.

The repository is currently in foundation development. Protocol,
measurement-contract, runtime, and workflow packages are added only through
their own issues and OpenSpec changes.

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
