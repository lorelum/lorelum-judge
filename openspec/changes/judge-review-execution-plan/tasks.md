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
- [ ] 6.4 审核范围、依赖和 diff；回读 issue/PR；更新 AI assistance。对固定提交 SHA 做隔离上下文独立只读 review，追加 commit 处理 findings，记录结果。不自动 merge。

## 实现验证记录

- 实现内容：protocol v2 定义/方法/完整 run/执行记录及冻结 rubric 转换与 v1 迁移；#9 交叉校验与 verified loader 版本分派；runtime 模型配置与响应 metadata；`@lorelum/provider-openai-compatible` 非流式 HTTP provider；`executeReview`、默认读取器、逐项校验、显式多次与生命周期；`evaluateReviewGate` 与一次调用 `review`；离线 program/mock LLM/review-to-gate 示例。
- `bun install --frozen-lockfile`：通过，Bun 1.4.2。
- `bun run validate`：通过；`biome check`、repository baseline、layer check、生成类型 up-to-date、typecheck、678 tests / 0 fail、6 package builds、Loaded 6 built package exports in Node ESM、隔离消费者三类示例通过。
- runtime conformance：passed=true，18/18。
- `openspec validate judge-review-execution-plan --type change --strict`：Change 'judge-review-execution-plan' is valid。
- 未执行：独立只读 review（待固定 commit SHA 后进行）；未使用真实 provider、key 或外部模型；合成 policy/示例不构成真实校准或质量证明。

## 规划验证记录

- 基线：0908b12c705f03c9b50ff287ab0f6d4de6b50c49；仅新增本 change Markdown。
- `openspec validate judge-review-execution-plan --type change --strict`：Change 'judge-review-execution-plan' is valid。
- `bun install --frozen-lockfile`：通过，Bun 1.4.2，安装 29 packages，lockfile 未变。
- `bun run validate`：通过，606 pass / 0 fail，5 package builds，Loaded 5 built package exports in Node ESM。
- runtime conformance（逐字命令见 design.md / implementation-prompt.md）：passed=true，18/18。
- 本轮没有源码实现，也未运行尚不存在的新 provider/评审示例或独立实现 review。上述检查仅证明规划所基于的现有代码验证通过，不证明 #10 功能已实现。
- Lorelum semantic query 因本地 embedding.failed 未取得 Practice 正文；已检查 model status 与 trace，不冒用检索摘要。
