# Contributing

## Development

```sh
bun install
bun run validate
```

## Change Rules

- Keep each change within one declared architectural boundary.
- Add or update the relevant package README when a boundary changes.
- Do not import provider SDKs or agent frameworks from `protocol`, `runtime`,
  or `judge`.
- Add focused contract or domain tests with every behavior change.
- Run `bun run validate` before opening a pull request.
