# @lorelum/judge

Owns judge domain rules and workflows: task framing, rubric authoring, evidence
collection, judgment, calibration, and gate decisions.

It consumes `@lorelum/judge-protocol` and `@lorelum/judge-runtime`. It does not own
provider SDKs, framework orchestration, or the engineering implementation workflow.

## 代码评价

`evaluateCode(input, ports)` 接受普通代码评价请求，自行取得必要上下文，返回结构化报告
和可直接阅读的中文 `text`。`renderCodeEvaluation(report)` 可重新渲染同一份记录，
不额外调用模型。没有数值评分，也不生成具体修复方案。

```ts
import { evaluateCode } from "@lorelum/judge";
import {
  createOpenAiCompatibleModel,
  describeEndpoint,
} from "@lorelum/provider-openai-compatible";

const endpoint = describeEndpoint(configuredEndpoint);
const result = await evaluateCode(
  {
    target: "https://github.com/owner/repository/pull/123",
    request: "检查此次变更是否破坏兼容性，不要给出修复方案",
    requirements: ["省略 limit 时仍默认返回 20 条"],
  },
  {
    model: createOpenAiCompatibleModel({
      endpoint: configuredEndpoint,
      apiKey: process.env.MODEL_API_KEY,
    }),
    method: {
      kind: "llm",
      provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
      endpointIdentity: endpoint.identity,
      model: { provider: configuredProvider, name: configuredModel },
    },
    sources: {
      github: {
        repositories: ["owner/repository"],
        token: process.env.GITHUB_TOKEN,
      },
    },
    allowModelDisclosure: true,
  },
);
if (!result.ok) throw new Error(JSON.stringify(result.issues));
console.log(result.text);
// result.value.status 必须单独检查；ok 表示返回了合法记录，不表示评价完成。
```

代码示例中的配置值由宿主提供；库不会自动登录、读取凭据文件或选用收费服务。
配置端点、模型与 method 必须对应。读取权限与向模型披露权限分开：
读取本地或远程来源后，没有显式 `allowModelDisclosure: true` 就不发送其内容。
直接提交的文本属于本次显式评价输入。

`target` 可以是 GitHub 链接、本地路径或 `CodeTarget`：

- `snippet`、`files`、`diff`、`comparison`：直接提供文本、文件或前后内容。
- `local`：文件或目录；可选 `ref` 从固定 Git 版本读取。
- `git`：明确选择 `staged`、`unstaged`、`untracked`、`working`、`commit`、
  `compare` 或 `branch`；新文件用 `paths` 明确纳入，版本／分支比较提供 `base`。
- `github`：文件、目录、仓库、commit、compare、PR 或作为资料的 Issue。

`context` 提供辅助来源，`requirementSources` 提供要求依据；
`opinions` 用于核实已有意见，`previousReport` 用于复查原问题。
来源中的评论仍是意见；将 Issue 放入 `requirementSources` 不会自动把讨论提议变成强制要求。
仓库和模块请求只评价实际取得的范围，不是完整审计。
GitHub 使用只读 REST tree/blob，无需 clone；本地 Git 需要主机安装可信 Git。
只支持 github.com，不默认支持其他平台或 Enterprise。

调用方可用 `sources.roots`、`sources.github.repositories` 缩小允许访问范围。
未设置 roots 时，本地只授权指定对象；没有仓库列表时，只使用明确选择的仓库
及该 PR 的 head 来源。不会执行候选代码、测试、hooks 或 filters，不自动 fetch，
也不修改目标或发表 GitHub 意见。

默认每个来源最多读取 64 个文本片段、4 MiB 原始内容、单文件 512 KiB，
发现 20,000 项、128 次读取请求；可在 `sources.limits` 调整。
采集与每轮核验分别受原始字节预算约束，核验预算不跨轮累积。
无法核验会保留不确定性，不伪装成已证实的来源变化。
默认最多两轮按需补查、每轮八项；`limits.maxContextRounds: 0` 禁止额外补查，
仍会执行一次任务与标准准备。准备调用与一次正式评价分账，无隐式重试。
`timeoutMs` 是整个高层请求的时限，`signal` 可取消；迟到响应不会恢复成功。

报告区分执行与覆盖：合法的 unknown 可以完成底层判断，但目标仍可能未完成。
`partial`、`failed`、`cancelled` 不能被当作“没有问题”；仅有 patch、材料缺失、
来源变化或无效引用均如实保留。完整记录固定版本与身份，旧报告不冒充更新后的 PR。
最终证据投影的截断／未展示、核实或复查的 `unresolved` 都使报告保持 `partial`；
范围说明分别列出已取得行和正式投影的完整可见行，不把读取等同于完整评价。
中文 renderer v2 展示逐项判断、判断说明和引用资料；合法的负面 verdict 即使没有
problem 或 summary，也不能被空列表解释为“没有问题”。`completed` 表示本次评价目标
已完成，不表示要求已满足或代码已通过质量门禁。未提供判断说明时如实标记，不补造理由。
PR 关联 Issue 的要求也参与 freshness 核验；核验 HTTP／网络错误只表示无法核实，
只有观察到实际 identity 不一致才报告来源变化。
默认标准是本项目版本化规则，不是数值量表或质量认证；报告不授予修改或交付权限。

`executeCodeReview` 是需要自行组合已准备计划和来源的低层 v2 执行入口；
普通消费者使用 `evaluateCode`。原有 `review`／`executeReview` 的 v1 默认行为不变，
新评价不自动进入 gate，也不复用旧校准来声称报告可信。

## Review execution

`review(input, ports)` is the one-call entry for ordinary users: it executes the
review once by default and returns the execution, findings, completeness, and a
gate result with quality outcome, enforcement mode, reasons, and a localised
explanation. When no policy is supplied it derives an advisory policy, so the
caller still learns that the result cannot automatically gate delivery.
`executeReview(input, ports)` exposes the same execution without the gate step;
`evaluateReviewGate(input)` projects an existing execution when the caller owns
that composition.

- `input` carries a `MeasurementDefinition/v2` (or the result of
  `frozenRubricToDefinition`), caller evidence, one method, optional explicit
  `repetitions`, `timeoutMs`, `signal`, and an optional execution `id`. Ports
  supply either a program checker or a `ModelPort`, plus an optional clock and ID
  generator.
- Inputs are snapshotted and identities are computed before any checker or model
  call. Invalid input returns issues and invokes nothing. Repeated execution is
  explicit and sequential: the default is one call, with no retry, cache, or
  replacement attempt.
- Program checkers receive the frozen definition, normalized evidence, and an
  `AbortSignal`, and return a verdict list. The same normalized text is hashed
  into the evidence manifest, so content identity, lengths, and checker input
  describe one material. Judge applies the same per-criterion and evidence
  validation as the LLM path. Thrown errors and rejections become a failed
  attempt; a pre-cancelled signal starts nothing; a late result cannot replace
  `cancelled`.
- The LLM path compiles a deterministic trusted rule prompt with `compilePrompt`
  and calls the injected `ModelPort` once per attempt. The provider is
  responsible only for transport.
- The default reader accepts bare JSON or exactly one complete `json` or
  unlabelled Markdown code block with surrounding whitespace. Text outside a
  block, multiple blocks, duplicate JSON keys, malformed JSON, unknown envelope
  fields, and non-array verdicts are refused. Nothing is repaired and no extra
  model call is made.
- Raw verdict assessment is canonical in protocol. `assessVerdicts` is shared
  by full run validation, stored partial executions, live review assessment,
  and gate partial observations. A duplicate group is excluded as a whole;
  unknown entries are ignored; missing coverage is reported only when the call
  site requires complete coverage.
- Each criterion is validated independently. Legal findings stay visible;
  missing, duplicate, unknown, illegal-verdict, and illegal-evidence entries get
  explicit issues. Duplicates are never resolved by picking one. A completed
  attempt carries a `MeasurementRun/v2`; a partial attempt carries legal
  verdicts and issues but no run; an attempt with no legal verdict fails.
  `ReviewFinding.disagreement` is true when the valid attempts for a criterion
  contain more than one distinct verdict; the representative `verdict` is the
  first valid one, not a majority prediction.
- `ReviewExecution/v1` retains every planned slot: `completed`, `partial`,
  `failed`, `cancelled`, or `not_started`, with request facts, server-declared
  metadata, and unknowns kept separate. Evidence and rendered messages change
  execution identity; they do not expire calibration by themselves.
- `evaluateReviewGate(input)` projects the execution onto #9. It reuses the
  verified-calibration loader, aggregation, evidence statuses, and localised
  findings. Partial findings remain visible and a supported required failure can
  keep the overall result failed, but an incomplete execution cannot pass and
  cannot gain enforced mode. It also compares the actual model/provider,
  endpoint, and explicit parameters with the instrument, and reports known
  response-model conflicts or missing response information instead of assuming
  a match. Without applicable calibration the review is advisory and never
  blocks delivery by itself.
- Review execution is split by concept: `review/input.ts` validates and
  prepares, `review/execute-attempt.ts` runs one attempt, `review/record.ts`
  builds lifecycle records, `review/findings.ts` aggregates, and `review.ts`
  only re-exports the public entrypoint. Evidence validation/manifest building
  lives in `evidence.ts` and is shared with prompt compilation.
- A caller-supplied gate policy is bound to the exact definition and instrument.
  A mismatch, including a different repetition count, is a validation error
  before any checker or model call. Calibration alone is different: if only a
  calibration bound to another repetition count is supplied, the requested
  execution still runs and the mismatched enforcement claim is declined.

The v1 definition/instrument/run helpers and the v1 calibration artifacts keep
their behavior. `validateAny*` and the `#9` validators dispatch on the schema;
an old calibration is not relabelled as verified for a migrational v2 identity.

This package stops at evaluation results. It does not produce code changes,
suggestion workflows, benchmark migration, or an engineering workflow skeleton.
Bounded source collection belongs to `evaluateCode`; the lower-level review API
continues to consume caller-prepared evidence.

## Prompt compiler

`compilePrompt({ prompt, evidence })` turns rules and raw evidence into:

- `messages`: a system and a user `RuntimeMessage`, ready for `ModelPort.generate`.
- `manifest`: an `EvidenceBundle` (see `@lorelum/judge-protocol`) recording which
  evidence was rendered, truncated, or withheld, with exact lengths.
- `promptIdentity`: for `InstrumentProfile.promptIdentity`. Covers the normalized system
  text, template, variable bindings, render version, evidence budget, and rule budget.
- `renderIdentity`: covers the exact messages sent to the model.

Behavior:

- Evidence renders in id order. `evidenceBudget` counts code points of evidence text
  only; the first item that does not fit is truncated, later ones are withheld.
- An empty evidence item renders as `rendered` only while budget remains; after that it is
  `withheld`. It never supports a decisive verdict.
- Rules (system text, template, variable values) are capped by `ruleBudget`. An overflow
  fails with `rules_over_budget`; rules are never truncated.
- Text is normalized first (NFC, LF line endings, no trailing spaces or tabs). Content
  identities are computed here from the normalized text, not supplied by the caller.
  Content identity covers the text before escaping; lengths count the escaped text.
- Candidate `<evidence` and `</evidence` markers are escaped, case-insensitively, so
  candidate text cannot open or close a block. Only the `evidence` marker is escaped.
- Template placeholders are `{{name}}`. Every placeholder must be bound, every binding
  must be used, names match `^[a-z][a-z0-9_]*$`, and `{{evidence}}` is reserved and
  appears exactly once. Substitution is single pass; values are never re-expanded.
- The system message ends with a fixed notice that evidence blocks are data, not
  instructions. This is a stable marker; it does not stop a model from following
  instructions in evidence.
- Text with unpaired surrogates is rejected with the field's path, not canonicalized.
- `compilePrompt` never throws. Failures are `{ ok: false, issues }`.

This compiler does not make provider calls. The model call that uses it is in the rubric
compiler, through a caller-supplied `ModelPort`.

## Rubric compiler

`compileRubric({ rubricId, contract, prompt, instrument, contextIdentity, policyIdentity, model, runId, stepIndex, signal })`
turns a task contract into a proposal `RubricSet` and a `CompilationReport`.

- Acceptance items render as evidence with their ids, through `compilePrompt`. The
  compiler appends its own output instruction to the caller's system text; that text is
  part of the prompt identity.
- One `ModelPort.generate` call per contract. The response must be `structured`.
  `runId`, `stepIndex`, and `signal` come from the caller.
- Model output is untrusted. Every criterion goes through `validateCriterionDraft`; any
  failure fails the whole compilation. Nothing is repaired or dropped.
- The gate is deterministic: an unknown `covers`, `mergedFrom`, or evidence id fails the
  compilation; each covered acceptance needs its own evidence selector; one primary owner
  per evidence; a mandatory criterion needs a user, policy, or contract source and cannot
  be merged into a non-mandatory one; applicability is by `appliesTo` and task class;
  merges are only the declared `mergedFrom`, and the absorbed criteria's content is discarded.
  An undeclared conflict (same covers and same evidence, as #41 defines it) excludes both
  criteria; partial overlap is kept.
- Result: `{ ok: true, value }` with `rubric` (status `proposal`), `report`,
  `rubricIdentity`, and `binding`; or `{ ok: false, issues }`. Each issue has a
  `category`: `model`, `output`, `gate`, or `prompt`.
- `complete` is derived from the report: nothing uncovered, unsupported, or conflicting.
- `freezeRubric(compiled)` produces a `frozen` rubric only when the report validates
  against the rubric and contract, is complete, and every criterion has anchors. It
  needs no review record.

The task class reaches the model as an ASCII JSON string (non-ASCII escaped as `\uXXXX`), so
NFC normalization of the system message cannot change the class the model must echo back.

Not done here: retries, splitting, output repair, repo context selection, calibration
(#9), and migration (#10). `contextIdentity` and `policyIdentity` are required `sha256:`
identities, bound into the rubric identity and not verified. The surviving criterion keeps
its own role, anchors, and evidence. Criteria merged into it leave the rubric, and their
descriptions and anchors are discarded, not recorded; the report lists only their ids. The
survivor must select evidence for every acceptance id they cover. `freezeRubric` accepts only
a result that `compileRubric` returned, and checks the report against the rubric and contract.
Copies and hand-built objects are refused.

## Calibration and gate

`createDefaultGatePolicyV2` creates the published starter policy for explicit task-class
and evidence-shape scopes. It binds the measurement definition and instrument, requires
three observations per case, uses a 2/3 agreement threshold and 20 independent holdout
groups per required case category, and checks 95% Wilson intervals against false-accept
5%, false-reject 10%, abstention 20%, and disagreement 20% limits. The default helper
requires an `InstrumentProfile` with three repetitions. These are eligibility limits, not
a claim that a judge has achieved them.

`buildCalibration` validates caller-supplied development/holdout task groups and returns a
report plus per-scope artifacts in `shadow`. Repetitions and behavior variants count once
per task group; unsupported verdict evidence and failed observations are reported, not
converted into quality failures. Failure categories are counted at most once per task group
and remain `unattributed` unless diagnostics identify a cause. Only held-out groups
contribute to eligibility.

`loadVerifiedCalibration` recomputes that report and returns a process-local verified
value. Persisted values must be loaded again after restart. A raw artifact marked
`enforced` is not sufficient: identities, report, scope, validity, and every eligibility
metric must match. The caller explicitly changes a qualifying artifact to `enforced` to
enable automatic blocking.

`evaluateGate` consumes the verified value when available and returns a `GateDecision`
with a human-readable Chinese summary by default (English is supported), criterion-level
findings, evidence IDs, and next steps. Quality is `pass`, `fail`, or `indeterminate`;
execution mode separately says whether the result is enforced or advisory. An evidence-
backed mandatory failure takes precedence over other pending criteria, which remain visible.
The protocol rejects duplicate criterion findings and a total quality result that conflicts
with those findings. Supplied failure categories remain machine-readable and are described
in human-readable Chinese or English; unknown causes stay explicitly unattributed. Without applicable verified calibration, an informative result is
still returned in the policy fallback mode and cannot block.

If valid evidence is available but every repeated verdict is `unknown` or `insufficient`,
the finding reports a Judge abstention rather than claiming evidence is missing. An
unacceptable optional criterion includes its matching anchor but remains advisory and does
not block overall acceptance. Evidence marked `no_evidence` and evidence marked `unavailable`
receive different reasons and next steps.
