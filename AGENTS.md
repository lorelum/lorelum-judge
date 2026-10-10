# Lorelum Judge Agent Rules

本文件是 `lorelum/lorelum-judge` 的根级 Agent 执行规范。它适用于所有 package、应用、测试、文档和自动化 agent，除非当前 Issue、OpenSpec change 或用户明确给出更窄且不冲突的范围。

本文件只写跨任务、高频或高后果的规则。详细架构和领域契约以对应文档、stable spec、schema 和当前 change 为准。

## 1. 仓库定位

Lorelum Judge 是一个可独立消费的软件工程质量评测代理。它拥有：

- TaskContract 和 measurement contract；
- rubric authoring；
- evidence collection 和 prompt projection；
- measurement、calibration 和 gate decision；
- engineering workflow 的规划、实现、修改、交付和长期演进。

本仓库不是 benchmark suite，也不拥有 benchmark fixture、候选任务、运行环境或实验编排。benchmark 仓库通过公开 protocol 消费 Judge，不能通过相对路径依赖 Judge 内部实现。

当前 foundation 已进入 `main`。measurement layer 和 engineering workflow 仍按 issue #5 到 #11 分阶段实现，不能把 roadmap 描述成已完成能力。

## 2. 权威来源

发生冲突时，按以下优先级判断：

1. 用户当前明确目标；
2. 当前 Issue 和正在实施的 OpenSpec change；
3. `packages/protocol` 中的版本化公开契约和后续 `schemas/`；
4. 本文件 `AGENTS.md`；
5. `docs/architecture/`、`docs/decisions/`、`CONTRIBUTING.md`；
6. README、测试、注释和历史材料。

补充规则：

- README 和架构文档解释设计，不替代代码、OpenSpec 或 schema；
- `docs/decisions/` 记录已经接受的 ADR，不能静默绕过；
- 当前 issue 只拥有其声明范围，不能把某个实验结论升级为全仓库规则；
- 未跟踪文件、临时草案和用户本地工具不属于已提交规范；
- 两个规范来源仍冲突时，停止静默实现，先指出冲突并请求修正权威来源。

## 3. Package 所有权和依赖方向

核心依赖方向为：

```text
protocol -> no workspace package
runtime  -> protocol
judge    -> protocol, runtime
workflow -> protocol, runtime, judge
testing  -> protocol, runtime, judge
```

可以概括为：

```text
protocol <- runtime <- judge <- workflow
```

| Package | 所有权 |
| --- | --- |
| `packages/protocol` | 跨进程、跨 package、跨仓库和持久化边界 |
| `packages/runtime` | framework-neutral run、step、event、failure、resume、cancel 和 ports |
| `packages/judge` | task framing、rubric、evidence、measurement、calibration 和 gate domain |
| `packages/workflow` | planning、implementation、revision、delivery、budget 和 stop condition |
| `packages/testing` | deterministic model、store、clock、telemetry、fixture 和 conformance |

规则：

- `protocol` 不依赖 runtime、judge、workflow 或 adapter；
- `runtime` 不拥有 rubric、verdict、calibration 或 gate；
- `judge` 不拥有 provider SDK 或 framework orchestration；
- `workflow` 不重新定义 measurement semantics；
- `testing` 不能被 production package 依赖；
- 跨 package 相对 import、未声明 workspace dependency 和反向依赖必须失败；
- framework adapter 使用 `packages/runtime-*`，provider SDK 使用 `packages/provider-*`；
- 没有真实实现和消费者时，不创建空 package 或空能力。

## 4. 必须长期保持的不变量

### 4.1 框架和 provider 不能拥有 measurement identity

- framework run、session、memory、graph 和 tracing 对象不得进入 protocol；
- provider SDK、streaming chunk 或认证对象不得进入 persisted record；
- runtime 与 provider 实现必须位于 adapter 或 integration package；
- 替换 framework、provider 或 runtime 不得要求重写 measurement contract；
- `RuntimeRun` 只能作为执行记录，不能代替 `MeasurementRun`。

### 4.2 measurement identity 必须可失效

一次 measurement identity 至少要能回答测什么、用什么 instrument 测、使用了哪些 evidence，以及 prompt、model、runtime、decoding 和 policy 是什么。

以下任一变化必须使旧 calibration 失效：

- rubric 或 criterion；
- anchor、scale 或 verdict policy；
- evidence ownership 或 prompt projection；
- model、runtime 或 decoding；
- calibration 或 gate policy。

identity 不一致时，可以 shadow、diagnostic 或明确标记 indeterminate，但不能直接 enforce。

### 4.3 缺失证据不能被伪造

- 缺失 evidence 不能自动写成 0 分、失败或 `not-observed`；
- 必须区分 no evidence、unavailable、truncated 和 contradiction；
- 没有 evidence 的 verdict 只能进入 `unknown` 或 `insufficient`；
- verdict 必须能引用 evidence ID；
- 同一 evidence 只能有一个 primary scoring owner，允许其他 criterion 以明确引用方式消费。

### 4.4 scale、confidence 和 gate 必须有执行语义

- criterion 不能只有 description 和 max points，必须有有限 verdict 和 anchors；
- 绝对分不能在没有校准的情况下直接回答相对问题；
- confidence、repetition、disagreement 和 threshold 必须参与 gate 或明确标记为不参与；
- gate failure 必须区分 rubric、fixture、evidence、prompt、provider、threshold 和 measurement noise；
- shadow、diagnostic、provisional、enforced、expired 和 revoked 是不同状态；
- 未校准测量不能阻塞无关流程，只能按声明的降级行为运行。

### 4.5 runtime 语义不能被 framework 改写

- `running`、`paused`、`completed`、`failed` 和 `cancelled` 必须保持不同状态；
- `step_completed` 和 terminal `run_completed` 使用刚完成的 step index；
- 下一步 `model_requested` 才进入新 step index；
- 每个完成 step 后先持久化，再继续 loop；
- store、clock、telemetry、model、tool 和 execution port 异常必须变成结构化失败，不能无记录 reject；
- `resume()` 没有剩余 budget 时返回结构化错误，不能返回 `ok: true` 后立即 paused；
- Node ESM dist 入口必须真实可加载，不能只验证 TypeScript 编译成功。

### 4.6 workflow 不等于 judge

- judge 回答“事实是什么”和“测量是否可信”；
- workflow 回答“下一步做什么”；
- revision policy、budget、retry 和 implementation state 不得改变 rubric 或 gate；
- quality accept 不自动授予 commit、push、merge、release 或 deploy 权限。

## 5. 当前实现边界

已经被实现并有验证支持的 foundation：

- 根 workspace、lockfile 和统一 `validate`；
- package ownership 和 import boundary；
- NodeNext build 和 Node ESM dist smoke test；
- framework-neutral runtime ports、state、event、failure、resume 和 cancel；
- deterministic test doubles；
- 18 项 runtime conformance；
- protocol、judge 和 workflow 的边界，部分 package 仍只有 no-op entrypoint。

尚未实现的内容：

- `protocol` 中的 measurement contract；
- `judge` 中的 rubric、evidence、prompt compiler、calibration 和 gate；
- `workflow` 中的 planner、implementer、revision 和 delivery；
- 真实 provider、framework 和 execution adapter；
- 跨任务泛化、误放、误拒和方差证明。

Agent 不得把 package 存在或 roadmap 描述成能力已经完成。未实现能力必须明确标记 deferred、shadow、diagnostic 或 indeterminate。

## 6. 变更分类与门禁

### 6.1 直接 PR

以下改动可以直接创建 PR：

- 不改变 public schema、package interface、runtime contract、measurement semantics、persisted record 或 pipeline gate 的文档和工具修复；
- 明确修正现有 stable spec 的文字冲突，且不改变适用范围或允许行为；
- 用户授权的本地诊断，且不创建正式 measurement、calibration 或 gate artifact。

直接 PR 正文必须说明根因、修复边界、验证命令和未执行检查。

### 6.2 Contract-class change

以下属于 contract-class change：

- public schema；
- package interface；
- runtime contract；
- measurement、rubric、evidence、calibration 和 gate semantics；
- persisted record；
- pipeline gate；
- OpenSpec stable capability；
- workflow decision 和 delivery contract。

Contract-class change 必须：

1. 先确认一个收敛的 GitHub Issue；
2. 在 `openspec/changes/<change-name>/` 创建 change；
3. 做 strict validation；
4. 从最新 `main` 创建 `codex/<change-name>`；
5. PR 先放 OpenSpec artifacts，再在同一分支和 PR 继续实现；
6. 在实现前完成范围、效果、验证和非目标规划；
7. 实现时按 `tasks.md` 顺序推进并即时勾选；
8. 合并前披露 AI assistance 和独立 review findings。

不得为同一 change 另开实现 PR，不得把未完成能力描述为已完成，也不得通过“文档修复”绕过 contract 变更。

### 6.3 本地诊断

用户明确授权的本地测试或诊断：

- 不自动需要 issue；
- 不得创建正式 measurement、calibration 或 release artifact；
- 不得绕过 identity、evidence 或 public contract；
- 结果只能作为 diagnostic，不能当作正式质量结论。

## 7. Agent 工作流程

### 7.1 开始前

1. 读取 `git status`，识别未提交和未跟踪文件，不能覆盖或顺手纳入用户工作。
2. 判断本次变更属于直接修复、contract change、本地诊断还是 review。
3. 读取对应权威来源：
   - 总布局：`docs/architecture/repository-layout.md`
   - runtime：`docs/architecture/runtime-port-rationale.md`
   - ADR：`docs/decisions/`
   - 变更流程：`CONTRIBUTING.md`
   - 当前 change：对应 issue 和 `openspec/changes/`
4. 明确范围、非目标、验收和依赖。信息不足且会改变方案时必须暂停询问。
5. 不把 README、历史分支或一次实验当作新 contract 的唯一依据。

### 7.2 实施中

- 保持单一 PR 范围；
- 不在 protocol、judge 或持久化对象中引入 framework/provider 类型；
- 不修改已经冻结的 measurement definition 或 calibration identity；
- 优先复用 protocol、runtime 和 judge 的 canonical helper；
- 新增 package 前必须有 owner、README、真实消费者和依赖 policy；
- 不在 `judge` 中实现 workflow control，也不在 `workflow` 中重写 rubric；
- 发现无关改动时拆分到独立 Issue/PR；
- 对用户明确纠正，立即修正当前理解，不沿用被否定的假设。

### 7.3 结束前

- 运行适用验证并记录逐字命令和结果；
- 检查 `git diff` 只包含本 PR 范围；
- 检查 protocol、runtime、judge、workflow 和 adapter 的依赖方向；
- 检查 public contract、persisted record 和 identity 是否发生未声明变化；
- 检查空 package 没有被描述成完成实现；
- 回读 GitHub issue、PR 和评论，确认 Markdown 没有损坏。

## 8. 验证矩阵

基础验证：

```sh
bun install --frozen-lockfile
bun run validate
```

`bun run validate` 包含：

```text
biome check
repository baseline
workspace layer check
TypeScript typecheck
unit and conformance tests
all package builds
Node ESM dist smoke test
```

修改 runtime 或 conformance 时追加：

```sh
bun -e 'import { referenceRuntime } from "./packages/runtime/src/index.ts"; import { runRuntimeConformance } from "./packages/testing/src/index.ts"; const report = await runRuntimeConformance(referenceRuntime); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exit(1);'
```

修改或新增 OpenSpec change 时追加：

```sh
openspec validate <change-name> --type change --strict
```

验证要求：

- 不把“本地已测试”当证据，必须给实际命令和输出；
- 不跳过 layer check、Node ESM load 或 conformance；
- 核心 contract 测试不得依赖网络、真实模型或 provider key；
- CI 与本地必须使用同一 Bun 版本和验证入口；
- 失败条件必须可复现，不能只报告一个总布尔值。

## 9. Issue、分支、PR 和 Review

- Issue、PR 标题、正文、review 和重要评论默认使用中文；
- 文件路径、命令、代码标识符和错误信息保留原文；
- 每个 PR 只声明一个范围并链接对应 issue；
- 分支使用 `codex/<change-name>`；
- review fix 以新 commit 追加，不重写已发布历史；
- PR 正文必须让未阅读聊天上下文的 reviewer 知道改了什么、怎样验证和延期了什么；
- 使用 AI 编写、测试或 review 时，披露参与范围、AI findings 和处理结果；
- 独立 review 必须使用与实现隔离的 context，并固定 review 的 commit SHA；
- review 只读，不借 review 顺手改代码。

## 10. 安全与数据边界

- 不提交真实 token、密钥、内部地址、个人信息或未脱敏日志；
- 不把 benchmark fixture、candidate workspace 或 provider 凭据写入 contract；
- 不把 private rubric、evaluator、oracle 或 calibration material 放入公开 material；
- 不在 CI 中调用外部模型 provider；
- 安全漏洞按 `SECURITY.md` 私下报告；
- 不使用 destructive git 或文件系统操作清理用户工作。

## 11. 规则维护

普通用户纠正只修正当前任务。只有以下条件之一满足时，才启动规则沉淀评估：

1. 同一错误模式在两个有可核验证据的独立任务或对话中复现；
2. 一次高风险事件暴露规范缺失、冲突或入口不可发现；
3. 用户明确要求把经验提升为可复用规则。

触发评估不等于新增规则：

- 先检查现有 rules、ADR、stable spec 和当前 change；
- 优先合并、替换、收窄或删除，不为提高服从率叠加同义条款；
- 当前任务决定留在 Issue/OpenSpec；
- measurement contract 进入 protocol 和 stable spec；
- 只有跨任务、高频或高后果的 agent 工作方式进入本文件。

## 12. 提交前检查清单

开始前：

- [ ] 已确认工作树状态和用户未跟踪文件；
- [ ] 已确认变更类型和权威来源；
- [ ] Contract change 已有 Issue、OpenSpec 和规划范围；
- [ ] 已确认不会修改冻结 identity 或已完成 package 的公共语义。

提交前：

- [ ] `bun run validate` 通过；
- [ ] Node ESM dist 加载通过；
- [ ] runtime conformance 在适用时通过；
- [ ] 依赖方向和 package ownership 未被破坏；
- [ ] 缺失 evidence、confidence 和 gate 语义没有被伪装；
- [ ] PR diff 只包含声明范围；
- [ ] Issue、OpenSpec tasks 和 PR 正文已回读。
