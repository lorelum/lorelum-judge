# 实施设计

## 公开入口与依赖

在 @lorelum/judge 导出 evaluateCode(input, ports) 与 renderCodeEvaluation(report)。input 提供 target、自然语言 request、可选 requirements/opinions/previousReport；ports 提供 ModelPort、ReviewMethodInput、只读来源配置、signal/timeout 和资源上限。普通调用不要求底层评测结构。使用 Node 标准库与 fetch，不引入新的 workspace package。来源实现在 judge/src/sources；协议归 protocol；provider 只负责模型传输，workflow 不参与。

## 来源快照

SourceSnapshot/v1 保存材料 items、请求与实际版本、比较关系、读取 issues、覆盖与一致性。每个 item 有稳定本次 id、角色 target/context/requirement/opinion、路径或片段名、side current/old/new、版本、原始内容身份、文本及起始行。模型只引用 item id 与行范围，路径由程序解析，不能自由编造。原始字节摘要与规范化 evidence identity 分开。已发现、已读取与实际评价范围分别记录。

直接输入支持片段、文件文本、patch 和 old/new。纯 patch 的位置仅证明 patch 所声明的位置，不宣称取得完整文件。来源模块提供统一收集与补读接口，最终材料冻结后才调用正式评价。

比较项的 version 必须使用对应比较的整组 base/head 身份（分支旧侧为 merge base），单文件原始摘要仍由 contentIdentity 表示。新增/删除只有读取器通过完整树、明确 old/new 文件集或 /dev/null patch 建立后才记录 addedPaths/deletedPaths；缺失节选不能证明不存在。introduced/amplified 必须绑定同一比较的前后证据；introduced 另允许读取器已经证明的新增/删除，不能强迫新增文件伪造旧侧代码。

本地文件以授权根约束 realpath，不默认跟随越界链接或特殊文件。Git 通过参数数组调用受信客户端，不执行 shell/filters/textconv/fsmonitor/hooks，不自动 fetch。暂存 HEAD→index，未暂存 index→工作区，新文件须明确纳入；commit 对父节点（merge 默认 first parent，记录选择），root 对空树；两版本直接比较，分支引入变更以明确 base 的 merge base 对 head。冲突 index、基线歧义、缺失对象与工作区变化显式报告。工作区内容直接读取，不依赖可执行转换过滤器。

GitHub 使用固定 api.github.com GET，凭据只在内存请求头，不传播到分页外域。支持文件/目录/仓库、commit/compare/PR、Issue 及相关意见。固定 SHA 后按 tree/blob 读取；含斜杠 ref 须解析并验证路径，歧义不猜。PR 使用固定 base/head 的 merge base，不使用临时 merge commit。比较文件清单不能仅依赖受上限限制的 PR files，使用 tree 遍历/比较；超限保留未覆盖。二进制、submodule、LFS 等不伪装文本或自动扩大来源。

## 准备与评价

默认标准覆盖可见行为、边界/失败、适用安全/并发/资源/性能和具体维护影响；不将偏好视为缺陷。用户要求保留原文和来源；重点与仅限区分。模型可整理任务、选择标准和请求补读，但程序校验全部读取与标准来源，不能授予权限。准备通过普通文本 JSON，tools=[]；最多两轮补查，无修补或重试。读取限制可配置，超限作为 coverage 限制。取消贯穿准备与评价，迟到结果不得复活。

准备生成 ReviewPlan/v1：任务类型、请求、要求、采用/排除标准、MeasurementDefinition/v2、source identity 与准备调用事实。直接构造并验证 v2 definition；不强行改造只接受 structured 输出的旧 compileRubric，不伪造 frozen rubric。复用 validateCriteria、assessVerdicts、compilePrompt、identityOf。每条 evidence 只有一个 primary owner，其他条目 reference；材料分配不得复制同一内容规避所有权。

ReviewPlan 的 evidenceBudget 记录最终证据投影上限并进入 identity；高层显式预算同时用于准备与正式评价，不能只限制准备阶段。指令与结构化元数据不计入此文本投影预算。GitHub 文件获取累计原始字节，即使二进制、LFS 或非法 UTF-8 最后未作为文本材料纳入，也不得绕过获取预算。

ReviewResult/v2 在 Verdict/v1 之外保存 summary、problems、pending、followUps。问题包含 criterionId、evidenceIds、位置、影响重要性、条件、影响与归因；多问题可属于同一条目。核实/复查有明确历史引用和结果，不以空问题列表表达全部已解决。

ReviewExecution/v2 保存计划/来源引用与结果协议，实际 attempt 记录新结果及诊断。旧 API 默认 v1；通过显式 v2 选择复用 input/method/parser/execute-attempt/record 内核。旧 prompt/parser 常量保持，不改变旧 instrument identity；新协议选择新 compiler/parser 标识。MeasurementRun/v2 仍只承载完整合法 verdict，summary/problem 不塞入 run。所有 verdict 合法但问题非法也只能 partial；partial 无完整 run。无合法 verdict 则 failed，问题文本不能补成判断。不得将 v2 execution 静默剥字段送旧 gate；高层不自动进入 gate。

## 报告

CodeEvaluationReport/v1 绑定 source、plan、execution 和前次报告/问题引用。执行完整性与目标覆盖分开：合法 unknown 不是 parser failure，但缺少关键依据不能整体宣称完成。准备失败可无正式 plan/execution；保留已取得资料和失败原因。

summary 为本次评价结果的一部分，引用问题/标准/证据；渲染使用确定性中文模板，不额外模型润色。重要问题、未知与限制固定展示；报告无 score、修复步骤或交付资格。验证真实路径/侧/版本/已显示行；截断末行不当作完整可引用行。语义判断仍需真实模型质量证据，结构合法不等于解释正确。

## 验证与实施分工

主线程拥有设计、接口边界、集成和最终完成依据。protocol/review 为一个负责人；local/Git 与 GitHub 在共同来源接口确定后独立实现；高层编排依赖契约，主线程完成。仅保留错误版本、无效引用假成功、缺资料、越界和取消等实际风险回归，复用现有消费 runner 与 HTTP 工具。执行公开入口 smoke、bun run validate 和 strict validation；不重复既有传输测试，不调用真实收费模型。真实服务未验证须披露。
