# 实施任务

## 1. 规划

- [x] 1.1 核对修订 Issue、固定主线和用户批准计划，建立独立工作树。
- [x] 1.2 完成 OpenSpec strict validation，建立同一长期规划 PR #62（规划提交 0524c7e）。

## 2. 契约与执行

- [x] 2.1 实现来源、计划、问题和报告的版本化公开契约与身份。
- [x] 2.2 实现 ReviewResult/v2 与 ReviewExecution/v2，接入已有执行与完整性校验；旧 API/identity/gate 保持行为。

## 3. 来源

- [x] 3.1 实现直接材料和位置映射。
- [x] 3.2 实现本地文件、目录、Git 选择、版本比较和一致性/权限边界。
- [x] 3.3 实现 GitHub 文件、目录、仓库、commit、compare、PR、Issue/意见实际读取与分页/截断处理。

## 4. 评价与报告

- [x] 4.1 实现公开 evaluateCode、任务整理、默认标准、要求保留及有限上下文补查。
- [x] 4.2 实现意见核实与复查、整体描述、问题和限制的结构化报告与中文渲染。
- [x] 4.3 接通 provider 真实传输与取消/失败，无隐式修补、重试或操作副作用。

## 5. 完成依据

- [x] 5.1 通过公开 exports 实际 smoke 24 个代表性来源/任务路径，包含实际有限补查（49 次本地 HTTP 模型请求）；只补必要的消费者可见边界回归。
- [x] 5.2 更新接入文档和消费示例；本轮 bun run validate 通过（727 tests、1770 assertions、6 个 package build/Node ESM load、24 个公开消费场景），OpenSpec strict validation 与 git diff --check 通过。此前另经 Node 公开入口实际读取 GitHub 公开 README，固定 SHA 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d，来源一致且无读取问题；本地确定性响应只返回 unknown，报告保持 partial。截断及仅有负面 verdict 的中文报告已实际观察。未调用收费模型；真实私有仓库认证、fork PR 与模型评价质量未验证。
- [x] 5.3 已核对范围和敏感内容，固定 SHA 独立审查并处理发现；实现已推送，同一 PR #62 已更新完整证据与 AI assistance。保留草稿，未合并或发布。

## 独立审查发现处理

首次隔离只读审查固定 `f14001285191e065f37f2359ebe98d1e4fc8f2b0`，相对主线 `fdbfcb1ecd8debc770563f41e3f2f7986335b3b6`。发现 1 项 P1、4 项 P2，均已用实际 API／来源回归复现并修正：

- [x] 外部来源即使初始为空，也必须在任何模型调用前获得披露授权；不能借后续补查绕过。
- [x] 每轮核验独立计量；预算拒绝及无法核验不再伪装成内容变化，真实变化仍被识别。
- [x] 正式 evidence manifest 的截断／未展示进入覆盖限制，中文报告区分取得与投影范围。
- [x] 意见或原问题的 unresolved 使高层保持 partial，保留合法完成的底层执行。
- [x] 最终来源核验期间取消仍返回 cancelled，保留此前已完成的评价事实。

五项修正经固定提交 `83e6583be1808b8c6c2821a0222186710aab470b` 隔离复核，原发现均已解决，未发现修正引入的可确证直接回归。

交付核对另外发现并修正要求来源合并对评论角色的覆盖：Issue 评论保持 opinion，准备结果不能自动将讨论提议提升为 mandatory contract；已先复现 completed 假成功，再确认准备阶段拒绝。

最后单项修正固定 `ddea2709a87be32d2ff2a1edf46b151691e25a56` 再经隔离只读复核：无可确证问题，未发现直接回归。审查不代替真实模型质量验证，也不授予合并或发布权限。

## 对固定提交 30611ca 的五项 P2 审查修正

本轮以用户提供的复现为失败依据，不重复执行确认。沿用同一 Issue、分支和 PR，保留既有 v1 measurement、calibration 和 gate 语义。

- [x] verdict 按 criterion ID 对齐；合法逆序不再拒绝，内容或 rationale 被篡改仍拒绝。覆盖完整及部分执行。
- [x] 显式要求／意见统一 LF、CRLF、CR 的末尾换行行数规则，保留原始文本。
- [x] renderer v2 显示逐项判断、判断说明和引用资料；负面 verdict 不再被空问题列表隐藏。不强制伪造 problem。
- [x] 保留并执行 PR 关联 Issue verifier，PR SHA 不变而要求更新时也记录真实来源变化。
- [x] GitHub 核验错误保留 verification_unavailable 与脱敏原因；只有实际 identity 不匹配才标记 inconsistent，取消仍单独处理。
- [x] 完成本轮最终验证记录，已追加修正提交并更新同一 PR #62；保留草稿，不合并或发布。

本轮修正提交：`d4dc4bf8aa9df7c28685004c8746e19fc2eba9bf`。验证为 727 pass、0 fail、1770 assertions；公开消费为 24 场景、49 次本地 HTTP 请求。用户审查的固定基线及逐项处理已写入 PR；旧提交的独立复核不作为本修正提交已获独立审查的声明。
