# Offline consumer examples

Run after `bun run build`:

```sh
bun run check:examples
```

`scripts/check-examples.ts` copies these files into a temporary directory whose
only `node_modules/@lorelum` entries are symlinks to the workspace packages. The
scripts therefore load built `exports.import` entries, not `src`.

- `program-review.mjs`: frozen rubric conversion, caller-provided checker, one
  default invocation, complete v2 run.
- `mock-llm-review.mjs`: real HTTP request to a local Chat Completions mock
  through `@lorelum/provider-openai-compatible`, then Judge parsing and
  validation. No external model or key.
- `review-to-gate.mjs`: execution-to-gate projection. There is no calibration,
  so the result is advisory and cannot enforce.

The policy in these examples is illustrative. It is not a calibration artifact
and proves nothing about model quality; synthetic calibration remains a
demonstration, not evidence.
