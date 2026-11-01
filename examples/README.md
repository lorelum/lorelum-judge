# Offline consumer examples

Run after `bun run build`:

```sh
bun run check:examples
```

`scripts/check-examples.ts` copies these files into a temporary directory whose
only `node_modules/@lorelum` entries are symlinks to the workspace packages. The
scripts therefore load built `exports.import` entries, not `src`.

Consumer examples are plain JavaScript ESM (`.js`), declared by
`consumer/package.json` with `"type": "module"`. The TypeScript checker copies that
manifest alongside the examples, so the isolated Node consumer needs no transpiler
or experimental module flags.

- `program-review.js`: frozen rubric conversion, caller-provided checker, one
  default invocation, complete v2 run.
- `mock-llm-review.js`: real HTTP request to a local Chat Completions mock
  through `@lorelum/provider-openai-compatible`, then Judge parsing and
  validation. No external model or key.
- `review-to-gate.js`: execution-to-gate projection. There is no calibration,
  so the result is advisory and cannot enforce.
- `code-evaluation.js`: 高层公开 API 实际完成片段、文件、diff、前后比较、
  本地文件／模块、Git 各选择、GitHub 文件／目录／仓库／commit／compare／PR、
  Issue 要求、实际有限上下文补查、意见核实与问题复查。真实本地 HTTP 经过既有模型 provider；
  GitHub 用内存 REST 数据、Git 用临时仓库，无外部服务或真实凭据。
  确定性模型只识别示例中的条数问题，不代表真实模型的评价质量。
  另覆盖仅有负面逐项判断、verdict 逆序以及要求／意见末尾 CRLF；实际打印对应中文报告，
  不通过固定措辞断言替代观察。

The policy in these examples is illustrative. It is not a calibration artifact
and proves nothing about model quality; synthetic calibration remains a
demonstration, not evidence.
