# 设计：一次调用得到可信评审结果

## 1. 已确认的产品决定

1. 默认一次调用只执行一次评审；重复执行必须由调用方显式选择，不能把 benchmark 多次测量当成普通用户前置条件。
2. 每次执行选择程序检查或 LLM 一种方式，覆盖本次全部条目。程序检查由调用方提供函数，Judge 调用并校验；不负责启动测试或采集证据。
3. 参考项只展示发现和建议，不影响整体质量结论；即使原 criterion.mandatory 为 true，本次 role=advisory 也不参与阻断，原始要求保留。
4. 服务端点属于评审方法身份，切换端点不能自动沿用旧校准；记录端点摘要，不保存凭据。
5. 默认读取裸 JSON 或一个完整 Markdown JSON 代码块中的 JSON；不补写漏项、不猜结论、不更正引用、不追加模型调用修补答案。
6. 可可靠识别的合法部分结果仍向用户展示。未完成项、无效项和执行错误明确标记；没有充分依据不能整体通过。已确认的必选项问题可保留不通过结论，但不自动取得把关资格。
7. #11 承接修改建议与代码修改：接受人工或其他工具的意见，结合当前代码核实，无须先完整重评；直接修改须用户明确授权。范围内可自主修改和验证，关键产品选择缺失或越界再询问；提交、推送、合并和发布另行授权。修改后默认做相关验证，额外模型复评由用户或调用方开启。这些是后续消费边界，不是本期已完成能力。

## 2. 分层与公开入口

protocol 拥有跨边界 schema、校验和 canonical identity；runtime 拥有通用请求、响应、取消和失败语义；judge 拥有评审提示词、解析、结果校验、执行编排及 #9 接入；provider-openai-compatible 只拥有通用 HTTP 文本通信，运行时仅依赖 protocol/runtime。调用方组合 provider 与 Judge，不让 judge 依赖具体 provider。

建议公开 executeReview(input, ports) 入口，名称可以按仓库命名规范微调，职责不可省略。input 包括已验证定义或冻结 rubric 的规范转换结果、原始证据、所选方法、执行控制、可选把关 policy/calibration/scope。ports 注入程序检查函数或 ModelPort，以及测试所需 clock/ID 生成能力。不得让普通用户构造测试集或校准数据才能调用。

先验证并 snapshot 所有可序列化输入，再编译、计算身份、执行。输入非法时返回结构化 validation issues，不发起函数或模型调用；函数、AbortSignal、凭据不进入快照。调用方随后修改原对象不得改变已启动评审。

输出包括执行记录、逐项发现、证据状态、整体质量结论、是否完整、自动把关模式及原因/下一步。没有校准时依旧可完成普通参考评审。原始响应和证据只在调用方受控存储中按需保留；默认用户说明不回显响应正文、认证头或内部地址。

## 3. 版本演进和迁移

### 3.1 评审定义

新增 MeasurementDefinition/v2，保留原 criteria，并用逐项 metadata 保留 role、covers、appliesTo；metadata 与 criterion 一一对应，禁止遗漏、重复和未知 ID。由冻结 RubricSet 转换时还保存原 rubric identity、contractIdentity 和来源映射。转换器拒绝 proposal，不静默过滤条目或改写 criterion.mandatory。定义身份包括这些语义信息。

有效必选条件为 role=decisive 且 criterion.mandatory=true。参考项仍保留原 criterion 与 anchors。直接提供 v2 定义也必须显式提供 role，不能依赖隐含默认改变含义。

v1 继续按原 mandatory 规则运行；显式迁移为 v2 时 role 默认映射 decisive，并记录迁移来源，重新计算身份，不能将旧校准绑定替换成新身份。

### 3.2 评审方法

新增 InstrumentProfile/v2，以 kind=program 或 llm 区分方法，共有方法实现版本、结果协议/解析版本、runtime 身份和预定 repetitions。默认 API 构造一次执行配置；既有 calibration 与 policy 的次数要求不能被默认值覆盖。

program 声明检查器 ID 及版本或内容身份，不制造 model、decoding 或 prompt 字段。检查器代码与声明的一致性首版由调用方负责，记录为声明，不宣称认证；这是可执行设计假设，未做远端证明。

llm 包括 provider/adapter 协议版本、端点身份、请求模型、约定生成参数、规则提示词 identity、compiler/render/parser 版本。固定支持 temperature、topP、maxTokens、seed，映射为 temperature、top_p、max_tokens、seed；未指定的保持未指定，不虚构服务端默认值。拒绝未知配置，不静默删参数或切换模型。

端点摘要由 adapter 实际使用的无凭据规范 URL 计算：仅移除用于拼接 /chat/completions 的末尾斜杠差异；保留有意义的 path/query，不折叠不同代理。拒绝含 userinfo 的 URL；首版拒绝 query，凭据仅通过独立认证配置传入，因此不可能把 query token 纳入身份或记录。记录 protocol/provider identity 标签及 endpointIdentity，不记录原 URL。不同端点默认不同身份。轮换凭据不改变身份。

timeout、AbortSignal 属于执行控制，记录实际 timeout；超时作为失败保留。timeout 不改变成功输出的测量方法身份，不允许靠改变 timeout 丢弃失败或缩小计划。生成参数、模型、方法版本、端点、规则投影或次数变化必须触发适用性检查。

### 3.3 完整测量与执行记录

新增 MeasurementRun/v2，仍只表示恰好每条一个合法结论的完整测量，绑定定义、方法、本次证据、实际 render 与执行记录身份。instrumentSource 不升级为 verified；执行请求和响应声明是独立来源的事实。

新增 ReviewExecution/v1 可序列化记录，包含冻结输入身份、plannedCount、按计划编号的 attempts。每个 attempt 有唯一 ID、状态 completed/partial/failed/cancelled/not_started、时间、合法逐项结果、逐项 issues、证据 manifest、可选完整 run、结构化 failure、LLM request/response metadata 及明确 unknowns。程序路径没有虚假 prompt/model 元信息。未开始项没有虚假开始时间、响应或 run。

完整 run 校验与执行记录校验分开：partial 永远不能通过完整 run 校验。原始响应内容与 normalized parsed 内容如被保留须可区分。材料与实际消息变化改变本次执行身份，不自动改变作用范围内的校准身份。ID 可追溯到实际调用，历史记录重复引用不能伪装新调用。

### 3.4 现有消费者迁移

保留 InstrumentProfile/v1、MeasurementDefinition/v1、MeasurementRun/v1 的 schema 与既有 helper 行为，新增版本化 helpers 或明确的版本分派入口。更新 protocol exports、JSON schema 注册、生成类型、validator、identity、测试、judge 执行入口与 #9 loader。生成文件由脚本产生，不手改。

#9 的 GatePolicy/v2、CalibrationArtifact/v2、Dataset/Report/v1 在字段形状和含义不变处可保留版本；其 cross-record validators 增加 v2 定义/方法/完整 run 的显式分支，仍用 schema-specific identity 重算。若某项必须改变持久化形状或允许行为，必须先在本 change 补充对应版本及迁移，不通过放松旧校验绕过。已有 v1 artifact 不会因迁移自动变成 v2 方法的适用校准。

runtime 的 ModelRequest 增加可选 provider-neutral 文本调用配置；ModelResponse message 分支增加可选响应 metadata。保持既有 model/tool/structured 路径可用，runtime loop 转发及测试 doubles 显式适配；不得吞掉所需配置。不得把 SDK response 或 headers 整体塞入 port/record。conformance 及异常结构化语义继续满足。

## 4. 两条执行路径

程序检查函数接收冻结的定义、合法证据及取消信号，返回逐项 verdict；函数可基于材料实现自身检查，但不带 Judge 内置任务评分。Judge 捕获同步异常和 promise rejection。接收取消后禁止开始后续调用；不合作的函数无法强制停止，但迟到结果不得把已取消状态改回成功。

LLM 路径复用 compilePrompt、evidence manifest 和规范化身份。将完整要求、anchors、合法证据归属和有限输出格式放入受信规则区；材料保持不可信数据边界。provider 不理解 rubric、JSON verdict 或 gate。

provider 使用实际配置的 base URL 拼接 chat/completions，非流式文本请求，signal 与 timeout 均可终止 HTTP；记录所发送的模型与显式参数、响应 ID/model/finish reason/usage 等白名单字段。服务端 model 字符串仅是声明，不能证明内部权重或 decoding。认证值及服务端错误原文不直接持久化；错误只保留安全的类别、HTTP status 和经过脱敏的摘要。响应不支持、空内容、拒绝/截断、非 JSON envelope、HTTP 错误、超时与取消有可区分原因，无重试。

## 5. 读取、部分结果与失败

读取器接受前后空白、裸 JSON 或恰好一个完整 json/无语言代码块。代码块外存在实质文字、多块、坏 JSON、重复 JSON object key 等歧义输入必须拒绝，不能用正则挑第一个看起来合法的对象。记录 parser 版本，格式兼容不额外调用模型。

可可靠解析结构后，按 criterion 逐项验证：重复项全部标为该项无效，不挑一个；未知项记为响应问题，不冒充定义内条目；漏项标未完成；非法 verdict 或非法证据引用只使对应项无效，其他合法项可展示。整体形状不可解析时不靠截字符串挽救内容。保留 no_evidence、unavailable、truncated、contradiction 等状态；unknown/insufficient 是合法 verdict，不是 parser failure。

partial 记录不是完整 MeasurementRun。新增明确的执行到 gate 适配入口，保留逐项合法结果与无效/未完成状态，复用 #9 的逐项聚合和展示规则。不得造 unknown verdict 来补齐 run，也不得把 partial 当成功 calibration observation。对显式多次执行，缺失/失败槽位进入既有预定次数分母，不能仅按成功次数算比例。

只有有效必选项都有充分支持的可接受结论且适用范围有效时才可整体通过；已证实的必选项不满足可整体未通过，其余情况暂时无法判断。参考项不阻断。执行不完整、身份冲突或缺少校准要求的信息时，保留可展示发现，但不得取得原定 enforced 资格。

## 6. 校准适用性与重复执行

先复用 #9 verified calibration loader 重算身份与报告，禁止接受调用方伪造 verified 标记。额外比较此次实际发送配置和响应观察：显式返回模型与请求模型不同视为已知冲突，不能静默认作别名；必要响应字段缺失或远端行为无法确认时记录 unknown。校准如要求这类信息就降级。既有校准未声明的远端内部证明不臆造为新要求，但仍须检查已知冲突。

默认一次执行可给出参考意见；不自动继承三次校准的条件，也不触发三次调用。调用方显式计划 N 次时顺序执行、固定 N、不重试、不缓存、不补跑。取消保留当前 cancelled 和剩余 not_started。历史 run ID/内容身份重复引用不得增加有效次数或独立样本数；调用次数不证明统计独立。

## 7. 验证与交付

- 程序检查离线链路：默认一次调用、冻结输入、完整/部分结果、异常、预先取消和运行中取消。
- HTTP 本地模拟：真实 request body/headers（认证仅内存断言）、全部约定参数、返回 metadata、模型冲突、字段缺失、HTTP/JSON 错误、timeout、AbortSignal、迟到返回。
- rubric 转换：来源/覆盖/适用目标保留，mandatory+advisory 不阻断，draft 拒绝，v1 显式迁移不能沿用 identity。
- 读取：代码块默认支持；坏 JSON、重复 key、漏项、重复项、未知项、非法 verdict/引用不产生伪造有效 run；合法部分仍展示。
- #9：无校准、适用校准、端点/模型/参数/规则变更、必要响应未知、已知冲突、材料变化、partial、重复 run、取消和固定分母；已确认失败优先，同时证据状态保留。
- 隔离消费者只 import package exports；程序、mock LLM、执行到 gate 三类示例默认离线。合成校准明确为演示，不证明真实模型质量。
- bun install --frozen-lockfile、bun run validate、runtime conformance、OpenSpec strict validation；provider 纳入依赖/构建/Node ESM dist smoke。记录实际输出。
- 源码实现前已有 OpenSpec-first PR；同一分支/PR 继续实现，合并前隔离上下文固定 SHA 独立只读 review，披露 AI assistance/findings。规划本身不宣称功能完成。

## 8. 交接与本地旧草稿

本机另有 E:/lorelum-judge-review-execution 的未跟踪旧规划，占用 codex/judge-review-execution 分支。它不是本 change 的权威来源，本轮不覆盖、不提交、不混入。以本 change 和本轮用户决定为准，尤其是默认单次、合法部分结果展示及 #11 边界。执行记录交由调用方持久化，本期不承诺进程崩溃恢复或跨进程 exactly-once。

Runtime conformance 的逐字命令：

~~~sh
bun -e 'import { referenceRuntime } from "./packages/runtime/src/index.ts"; import { runRuntimeConformance } from "./packages/testing/src/index.ts"; const report = await runRuntimeConformance(referenceRuntime); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exit(1);'
~~~
