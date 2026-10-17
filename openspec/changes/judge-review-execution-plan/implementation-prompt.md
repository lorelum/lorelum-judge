# 新对话实施 Prompt：完成 lorelum/lorelum-judge issue #10

你现在接手 #10 的代码实现。此前对话已完成产品讨论与 OpenSpec 规划，本次请在既有规划分支和同一 PR 继续，完成实现、验证、文档及独立 review；不要只重新分析或另开实现 PR，不自动合并。

## 工作位置与权威来源

- 仓库：https://github.com/lorelum/lorelum-judge
- Issue：https://github.com/lorelum/lorelum-judge/issues/10
- 工作树：C:/Users/HP/.codex/worktrees/judge-review-execution/lorelum-judge
- 分支：codex/judge-review-execution-plan
- OpenSpec change：openspec/changes/judge-review-execution-plan/
- 本规划 PR：启动后用 gh pr view codex/judge-review-execution-plan --repo lorelum/lorelum-judge 查询，继续这一个 PR。
- 先读 AGENTS.md、CONTRIBUTING.md、本 change 的 proposal.md、design.md、specs/judge-review-execution/spec.md 和 tasks.md；再读 protocol schemas、相关 stable specs、docs/architecture 与 docs/decisions。
- 规则优先级依 AGENTS.md；本 prompt 记录本轮用户明确决定。未提交旧草稿不是规范。若发现真正冲突，指出具体来源，不静默改语义。
- E:/lorelum-judge 是独立 #9 修复工作树，不能在里面实现 #10。E:/lorelum-judge-review-execution 存在旧的未跟踪草稿与 codex/judge-review-execution 分支；不要覆盖、清理、提交或将其旧方案当作当前决定。

## 先核实的依赖

规划基于 origin/main 0908b12c705f03c9b50ff287ab0f6d4de6b50c49。2026-10-17 查询时 PR #50（#9 后续修复）仍 OPEN，head 为 593ac0d491c2d8519d7441a05916d2f4b624f366；这不是对其当前状态的保证，启动时重新查询。

先 git status，保护所有用户工作；fetch 并核对 #50 最终状态。#10 集成验收必须包含最终合并后的去重、证据状态保留与聚合修复。已合并时按仓库规则将包含修复的 main 合入本分支；不得重写已发布历史。尚未合并时可推进独立协议/provider 等工作，但不能复制未合并修复、声称依赖已存在或虚报整体完成。只在真正需要其契约且无法继续时说明准确阻塞。

## 产品目标：通用 Judge，默认一次评审

普通用户给规则、代码等材料和执行配置，一次调用得到逐项意见、依据、哪些没完成及能否用于自动把关的说明。不是让用户先准备 benchmark、多次调用或校准数据。

用户已确认产品有三类能力：评审代码；结合代码和已有意见给出修改建议；获得明确授权后直接修改代码。双方同意本期 #10 只实现第一类，后两类由 #11 实现。#10 的输出保留理由、证据、来源、完成状态，供后续消费；不为 #11 建空 package 或伪实现。

后续边界也已确定，写文档时保持一致：外部人工/工具意见可直接进入建议流程，结合代码核实，无须先完整重评；用户授权修改后可自主完成范围内修改与相关验证，关键产品决定缺失或越界时再询问；提交/推送/合并/发布另行授权；额外模型复评由用户或调用方开启。这些均不是 #10 需实现的功能。

## 不要重新打开的决定

1. 默认一次调用、一次评审。多次仅为显式选项，按计划顺序执行；不能为匹配已有三次校准而擅自发起三次。
2. 一次选择程序检查或 LLM 一种方式覆盖全部条目；不逐项混合。
3. 程序检查由调用方提供函数，Judge 调用、传取消信号并统一校验。材料已有，不启动测试、不自动采集、不内置任务专属评分。检查器方法身份由调用方声明，不宣称代码认证。
4. 参考项可展示问题但不影响整体结论，即使原始 criterion.mandatory=true；保留原始要求，不篡改源字段。
5. 端点纳入方法身份，更换服务端点不能自动沿用旧校准。凭据不进入身份、日志或持久化，端点记录摘要。
6. 默认支持裸 JSON 与单个完整 JSON/无语言 Markdown 代码块。这是读取兼容，不是修复功能。歧义和坏 JSON 不猜。
7. 合法部分发现要展示，未完成/无效项明确标记；不得把 partial 包成完整 MeasurementRun。已证实必选项不满足时可保留未通过结论，其余项继续展示；不完整结果不能整体通过或取得原定 enforced 资格。
8. 无证据、不可访问、截断、矛盾、服务失败不得填成零分或质量失败。unknown/insufficient 可是合法完成的评审结论。
9. 不自动重试、修补模型答案、补跑或缓存；不静默删生成参数或换模型。未来修复属于用户选择的功能，本期不做。
10. 材料变化改变本次执行身份，不能冒用历史结果；不自动使仍在作用范围内的校准失效。规则/模型/参数/端点/方法/策略变化必须检查适用性。
11. 实际请求、服务端声明、无法确认的信息分开记录；返回模型名不证明远端内部执行。

## 必须完成的实现

按 tasks.md 的顺序推进并即时勾选，不把规划任务当实现完成。

### Protocol 与迁移

- 新增 MeasurementDefinition/v2、InstrumentProfile/v2、MeasurementRun/v2、ReviewExecution/v1 的 schema、类型生成、exports、校验和身份 helper，具体结构遵循 design.md。
- 冻结 RubricSet 规范转换必须保留 rubric/contract identity、来源、covers、appliesTo 和 role；draft 拒绝。有效必选条件为 decisive 且 mandatory。
- 程序方法不含虚假模型字段；LLM 方法包括实际端点身份、模型、显式参数、compiler/parser/runtime 版本。证据/render 与可复用方法身份分开。
- 完整 run 仍要求每条恰好一个合法 verdict。执行记录可含合法部分、逐项 issues 和失败原因。
- 旧 v1 schema/helper 行为不变。#9 的交叉校验与 verified loader 显式支持新版本，不替换历史身份或伪造 verified。若需改变其他持久化形状，先在当前 change 补齐版本与迁移设计。

### Runtime / provider

- ModelPort 支持 provider-neutral 请求配置和响应 metadata；现有 structured、tool 和 runtime loop 行为继续可用，更新所有调用方及 doubles。
- 新 package provider-openai-compatible：非流式 Chat Completions 文本 HTTP 调用，支持 endpoint、独立凭据、model、temperature/topP/maxTokens/seed、timeout、AbortSignal。
- provider 只通信，Judge 编译 prompt、解析 JSON、解释评审。judge 不导入具体 provider；provider 不依赖 judge 或 testing 的 production exports。
- 明确 URL 规范与参数映射、响应 metadata 白名单和安全错误。拒绝不支持配置，保留未指定参数为未指定。
- 本地 HTTP 测试真实 wire 请求和响应；不能用真实模型或 key 做核心验收。

### Judge 与 #9

- 公开 executeReview 或同职责入口，预检/snapshot/identity 后执行；非法输入零调用，默认一次。
- 复用 prompt compiler、evidence helpers、criterion validators 和 #9 canonical aggregation，不另写评分/多数票。
- 读取支持约定格式；合法部分独立校验并展示，重复项不任选、漏项不补、未知项不计入要求。无法可靠解析时明确失败。
- 执行记录保留 completed/partial/failed/cancelled/not_started；取消后不启动后续，迟到结果不能覆盖终态。
- execution-to-gate 公开链路区分质量结论、完成状态、自动把关资格；不造完整 run 或成功 calibration observation。固定原计划分母，历史引用不增加次数或独立样本数。
- #9 verified calibration loader 重算报告和身份。检查实际发送配置、已知响应冲突、必要字段未知、作用范围与有效期。无校准仍可参考评审，不自动阻止交付。
- 默认中文，复用现有英文支持；用户说明清楚，不把内部 schema 字段名堆给普通用户。

### 交付与验收

- 文档说明 API、v1/v2 迁移、方法声明的信任边界、部分结果、默认单次、显式次数、取消与校准限制，明确 #11 deferred。
- 三类示例：程序检查；本地 HTTP mock 驱动真实 provider；执行结果到 #9。默认离线，合成校准只作演示。
- 隔离消费者仅通过公开 package exports 加载构建/打包产物，在 Node ESM 实际执行完整链路。新增 provider 加入 build、layer、dist 检查及 README。
- 测试应覆盖真实消费者行为和错误分支，不测试源码字面量或重复实现。

## 必须运行并记录的命令

逐字运行、报告实际结果与未执行项，不用“本地测试过”替代证据：

~~~sh
bun install --frozen-lockfile
bun run validate
openspec validate judge-review-execution-plan --type change --strict
bun -e 'import { referenceRuntime } from "./packages/runtime/src/index.ts"; import { runRuntimeConformance } from "./packages/testing/src/index.ts"; const report = await runRuntimeConformance(referenceRuntime); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exit(1);'
~~~

另外实际运行新示例和隔离 Node ESM 消费验证，记录命令与输出。bun run validate 必须包含 layer、生成类型、typecheck、tests、build 与 dist，不能省略。Bun 版本与 CI 一致，规划时为 1.4.2。

必须覆盖：默认零额外调用；冻结输入；参考项；程序异常/取消；HTTP/超时/取消；所有显式参数；坏 JSON/重复 key/代码块/遗漏/重复/未知条目/非法引用；合法 unknown；证据各状态；部分结果；支持性必选失败优先；无校准/适用校准/端点和配置变化/响应冲突及缺失；材料变化；显式多次的失败/取消/未开始、固定分母和历史去重。

## PR、review 与完成条件

继续已有规划 PR，中文 Conventional Commit 标题与自包含正文，关联 #10。注明 AI 编写、测试和 review 的参与范围，实际验证和 deferred。review fixes 追加 commit，不改写已发布历史。

实现完成后，用隔离上下文对固定 commit SHA 做独立只读 review；独立 review 的执行方式须符合当时工具权限和用户授权；如需额外授权，明确说明所需授权，不能虚报已经审查。review 不直接修改文件，主实现者处理 findings 后补验证并记录。不要仅以自己的回读冒充独立 review。

回读 PR/重要评论确认 Markdown 正常；检查 diff 只有 #10 范围、依赖方向正确、无 key/内部地址/未脱敏日志。完成后给出实现结果、验证证据、PR、剩余限制与 review findings。没有实际完成或依赖未解决就如实说明，不能勾完 tasks 或宣称 issue 完成。

## 规划阶段已有验证（不能当实现证明）

本轮仅新增规划 Markdown，无源码实现：OpenSpec strict valid；bun install --frozen-lockfile 通过；bun run validate 通过，606 tests / 0 fail、5 package build、5 Node ESM exports；runtime conformance 18/18。实现后的代码必须重新验证。规划未做独立实现 review。Lorelum semantic model 因 embedding.failed 未能提供实践正文，不宣称采用了检索结果。
