# 实施任务

按顺序推进，完成一项立即勾选；不得把规划勾选当作实现完成。

## 1. 规划与依赖

- [x] 1.1 读取 #10、#11、现有契约和用户已确认决定，明确默认单次与 #11 边界。
- [x] 1.2 从最新 origin/main 建立独立 codex/judge-review-execution-plan 分支，保留 #9 修复分支。
- [x] 1.3 完成 strict validation 和规划检查，建立同一长期 OpenSpec-first PR，记录规划验证。
- [x] 1.4 实现前确认 PR #50 最终状态及合并后的修复契约；更新本分支到含修复的 main，不复制未合并修复或混入其范围。若依赖仍未合并，可做不依赖部分，不能宣称集成验收完成。

## 2. Protocol

- [x] 2.1 实现 MeasurementDefinition/v2、InstrumentProfile/v2、MeasurementRun/v2、ReviewExecution/v1 schemas、生成类型、版本化 exports/validators/identities；完整 run 与 partial 分离。
- [x] 2.2 实现冻结 rubric 规范转换，保留来源、covers、appliesTo、role；验证参考项即使 mandatory 也不阻断，v1 迁移不冒用旧身份。
- [x] 2.3 将 #9 cross-record validators 和 verified loader 显式接入新版本，保留旧版本行为；需要其他持久化版本演进时先补本 change。
- [x] 2.4 测试版本迁移、identity 变化、凭据排除、材料/规则身份分离、完整/部分记录合法性及证据引用。

## 3. Runtime 与 provider

- [x] 3.1 演进 provider-neutral ModelPort 请求配置/响应 metadata，适配 loop、所有现有调用方和测试 doubles，保持 tool/structured 与结构化异常行为。
- [x] 3.2 实现 provider-openai-compatible 非流式文本 HTTP adapter，明确 URL/参数映射、白名单 metadata、脱敏、timeout/abort；无自动重试或降参。
- [x] 3.3 用本地 HTTP 测试请求、响应、配置拒绝、HTTP/格式错误、超时、取消、返回模型冲突和必要信息缺失。
- [x] 3.4 将 provider 纳入 workspace 依赖、README、构建与 Node ESM dist 检查，保持依赖方向。

## 4. Judge 执行

- [x] 4.1 实现公开入口、输入冻结与预检、默认单次、程序检查调用与异常/取消处理。
- [x] 4.2 复用 prompt compiler 编译规则和证据，连接 ModelPort，记录请求事实、服务端声明与 unknowns。
- [x] 4.3 实现默认格式读取和逐项校验，保留合法部分，明确漏项/重复/非法引用；不得补写或自动追加调用。
- [x] 4.4 实现显式顺序多次计划和生命周期，保留 partial/failed/cancelled/not_started，固定分母与历史去重，不补跑。

## 5. #9 衔接

- [x] 5.1 提供公开 execution-to-gate 接口，复用逐项聚合与用户说明，不用伪造完整 run 补齐部分结果。
- [x] 5.2 实现角色与 mandatory 联合判定、支持性失败优先、证据状态保留及执行完整性/质量/把关模式分离。
- [x] 5.3 校验实际配置、端点、响应冲突与必要未知信息；覆盖无校准、适用校准、材料变化与方法变化。
- [x] 5.4 回归显式次数、重复历史运行、部分失败和取消，不缩分母、不改变已修复 #9 的含义。

## 6. 交付

- [x] 6.1 提供公开 API 接入文档、迁移说明及离线 program/mock LLM/review-to-gate 示例；明确演示校准与 #11 deferred。
- [x] 6.2 隔离 Node ESM 消费者实际执行完整链路，禁止源码路径和真实 provider/key。
- [x] 6.3 运行并记录 bun install --frozen-lockfile、bun run validate、runtime conformance、OpenSpec strict validation 的实际输出和未执行项。
- [x] 6.4 审核范围、依赖和 diff；回读 issue/PR；更新 AI assistance。对固定提交 SHA 做隔离上下文独立只读 review，追加 commit 处理 findings，记录结果。不自动 merge。

## 实现验证记录

- 实现内容：protocol v2 定义/方法/完整 run/执行记录及冻结 rubric 转换与 v1 迁移；#9 交叉校验与 verified loader 版本分派；runtime 模型配置与响应 metadata；`@lorelum/provider-openai-compatible` 非流式 HTTP provider；`executeReview`、默认读取器、逐项校验、显式多次与生命周期；`evaluateReviewGate` 与一次调用 `review`；离线 program/mock LLM/review-to-gate 示例。
- `bun install --frozen-lockfile`：通过，Bun 1.4.2。
- `bun run validate`：通过；`biome check`、repository baseline、layer check、生成类型 up-to-date、typecheck、703 tests / 0 fail、6 package builds、Loaded 6 built package exports in Node ESM、隔离消费者三类示例通过。
- runtime conformance：passed=true，18/18。
- `openspec validate judge-review-execution-plan --type change --strict`：Change 'judge-review-execution-plan' is valid。
- 独立 review：固定 SHA 9252866 的首轮只读 review 报告 6 项 major（提示 verdict schema、provider 响应体超时、attempt 超时未中止底层调用、v2 run 证据身份未绑定、gate 未检查 prompt/render 身份、review gate 输入未预快照校验）和 2 项 minor（resume 配置、JSON 字符串内反引号）。8386ab2 已处理；固定 SHA 8386ab2 的复核确认多数修复，并指出 policy 语义校验仍需前置、resume override 未持久化。后续提交将 gate policy 的完整 `validateGatePolicyForV2` 校验移到执行前，并把实际模型配置写入 resume 状态；相应回归测试已加入。固定 SHA ef83429 的复核未发现 blocking/major 问题，仅指出 `review()` 直接调用预检执行时缺少结构化异常边界；8cf8d8b 已补充捕获和 instrument/scope mismatch 零调用测试，固定 SHA 8cf8d8b 的最终复核无 findings。
- 第二轮独立 review（固定 SHA 5df7bf2）报告 1 major、2 medium、2 medium-low、2 low/决策项。已用配置中的 `planner`（Sol medium）规划，并修复：不完整执行即使票数达到阈值也不得 pass；非法 ModelPort metadata 省略并记 unknown；空/不可表示 checker message 安全回退；程序路径统一使用归一化证据；非法 id/signal 在调用前拒绝；gate policy 身份不匹配错误路径拆分并记录为校验错误；ReviewFinding 增加 disagreement。对应回归测试已加入。
- 修复后的独立 review（固定 SHA 8f9aa83）未发现 blocking/major/minor 问题；其指出的“非空但含孤立代理项的 metadata 字符串仍可能使 execution 整体失败”残余风险已追加修复并覆盖测试。
- 结构性 review 收敛：`review.ts` 拆为 `review/input.ts`、`review/execute.ts`、`review/execute-attempt.ts`、`review/record.ts`、`review/findings.ts`、`review/types.ts`；protocol 新增 `assessVerdicts` 并由完整 run、partial、review、gate 共用；`qualityOutcomeFor` 成为唯一整体质量 reducer；evidence 校验/manifest 提取到 `evidence.ts` 并与 prompt compiler 共用；gate observation 统一为 measured/failed；gate policy 在执行前一次性准备；runtime 增加 `ModelPortError`、`isModelPortError` 和共享 `validateGenerationConfig`；review 解释文案移入 presentation；`measurement-v2` 拆分为 definition、instrument、run、execution 四个模块。
- 结构 review 复核（固定 SHA 588d616）指出：verified calibration 被 snapshot 会丢失 WeakSet 身份、提前失败 attempt 未记录真实完成时间、`EvidenceStatus`/`ValidationResult` 公共类型导出回退。已改为按引用传递 calibration，所有提前失败记录 clock 完成时间，并恢复类型导出与测试；补充 rejected model response 的提前失败时间覆盖。
- 未使用真实 provider、key 或外部模型；合成 policy/示例不构成真实校准或质量证明。

## 规划验证记录

- 基线：0908b12c705f03c9b50ff287ab0f6d4de6b50c49；仅新增本 change Markdown。
- `openspec validate judge-review-execution-plan --type change --strict`：Change 'judge-review-execution-plan' is valid。
- `bun install --frozen-lockfile`：通过，Bun 1.4.2，安装 29 packages，lockfile 未变。
- `bun run validate`：通过，606 pass / 0 fail，5 package builds，Loaded 5 built package exports in Node ESM。
- runtime conformance（逐字命令见 design.md / implementation-prompt.md）：passed=true，18/18。
- 本轮没有源码实现，也未运行尚不存在的新 provider/评审示例或独立实现 review。上述检查仅证明规划所基于的现有代码验证通过，不证明 #10 功能已实现。
- Lorelum semantic query 因本地 embedding.failed 未取得 Practice 正文；已检查 model status 与 trace，不冒用检索摘要。
