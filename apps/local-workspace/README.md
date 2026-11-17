# 本地工作区

开发中的 #68 草稿入口，依赖未合并的 #64 / #67；不表示正式发布。仅本机单用户访问；模型、项目和沙箱权限留在宿主。首批安全发现和执行需要支持 `openat2`、bubblewrap 与必要 namespace 的 Linux。请先阅读 `packages/runtime-bubblewrap/README.md` 中的工具链、mount、权限和共享内核边界。

## 准备与运行

使用 Bun 1.4.2 和 Node 22.21.0。先为实际执行命令的环境（Windows 或 WSL）配置能读取 `lorelum/lumen-ui` 的 Git 凭据。HTTPS 可使用 GitHub CLI 的 Git 凭据集成（`gh auth status` 检查当前登录，必要时在终端交互登录并运行 `gh auth setup-git`），也可使用系统 Git Credential Manager；不要把 token 写进仓库、远程 URL 或聊天。凭据必须能访问该私有仓库，组织有 SSO 要求时还需完成相应授权。

然后在 Judge 仓库运行：

```sh
bun run prepare:lumen
bun install --frozen-lockfile
bun run workspace:local
```

准备脚本首次从 `https://github.com/lorelum/lumen-ui.git` 克隆到被忽略的 `.lumen-cache/source`，检出固定 commit `b95a5409bfaba0e0f8db65c7a82257425f2ca99e` 并构建主题和组件，再把组件发布文件和运行时依赖清单复制到生成目录 `.lumen-cache/lumen-ui-package`。Judge 从该目录安装依赖，不锁定不同环境构建的 tarball 摘要；每次准备会重新创建该生成目录。之后复用源码克隆；已有克隆必须干净且位于指定 commit，脚本不会覆盖源码修改或自动切换版本。组件源码、构建产物和凭据均不提交到 Judge 仓库。首次克隆需要网络及仓库读取权限；构建和安装依赖也可能需要访问包源。

同时修改 LumenUI 和 Judge 时，应在独立的 LumenUI 工作树开发，先提交并推送 LumenUI 变更，再在 Judge 中同时更新 `scripts/prepare-lumen.ts` 的 `revision` 和 `.github/workflows/validate.yml` 的 checkout `ref`。确认 `.lumen-cache/source` 没有需要保留的更改后，在该克隆中执行 `git fetch origin` 和 `git checkout --detach <新 commit>`，再重新准备依赖并运行验证。若 LumenUI 包依赖或版本改变，还须更新 Judge 的 lockfile。不要将开发中的本地覆盖提交为正式依赖；当前准备脚本不提供脏工作树覆盖模式。

CI 在独立 runner 上检出相同 commit，不会读取开发机的克隆。仓库管理员须在 Judge 仓库的 Actions secrets 中配置 `LUMEN_UI_READ_TOKEN`：使用对 `lorelum/lumen-ui` 有效且仅授予必要读取权限的凭据（例如限定该仓库、`Contents: read` 的 fine-grained token），并满足组织授权要求。workflow 使用该 secret 仅检出组件仓库，`persist-credentials: false` 禁止将凭据保留在检出的 Git 配置中；缺少或无权读取的凭据会使该步骤失败。组件未来公开后可移除该读取凭据；在此之前，本地克隆不能替代 CI 授权。

公开 fork 的 pull request 默认拿不到上游仓库的 Actions secrets，因此上述 CI 步骤也不能读取私有组件库；不要使用 `pull_request_target` 或向不可信代码暴露 token 来绕过该限制。

宿主默认只监听随机 loopback 端口；可用 `LORELUM_WORKSPACE_PORT` 指定端口。可在页面配置 OpenAI-compatible 端点、模型名称及可选 API 密钥，也可在启动环境设置 `LORELUM_MODEL_ENDPOINT`、`LORELUM_MODEL_NAME` 和可选 `LORELUM_MODEL_API_KEY`。页面提交后清空密钥输入，密钥仅存于宿主内存，不写入状态、事件、日志或文件。不要把密钥发到对话或放入仓库。接收方地址或模型配置包含当前或历史密钥（包括 URL 编码）时，宿主会拒绝该配置；与状态协议字段冲突的密钥也会被拒绝，避免脱敏破坏状态结构。

页面使用共享对话和三个可切换模式：评价模式可直接发送 PR 链接及自然语言要求，调用 `evaluateCode`；建议模式使用当前评价调用 `generateCodeSuggestions`；修改模式可基于当前评价及其对应建议制定计划并经授权执行。普通消息可进入真实模型对话，不会自动读取项目；已有评价、建议和计划可能作为上下文，须在发送前审核。评价是定性结论而非数字分数；建议接口不接收自定义指导，且不执行或修改代码。仅实际读取项目或执行修改时需要项目路径。每次模型请求在发送前展示接收方、配置和完整消息并要求明确同意；失败不静默回退到离线模型。

模型设置和项目设置按需展开；规划模式可在输入框下添加参考资料。输入框支持 Enter 发送、Shift+Enter 换行。模型输出和报告以纯文本展示，可按需复制。

重新评价、生成建议或重新发现工作区会撤销旧计划和待授权的规划请求；需要修改时应重新规划。对话中之前的用户消息、普通模型回复及填写的规划资料会作为规划参考并进入待审披露，不等于已经核实的项目事实。选择的项目路径由宿主绑定用户选择时发现的工作区及文件身份；工作区不一致时拒绝旧选择。

评价支持代码片段和公开 GitHub PR URL；宿主读取 PR 元数据，将实际基础仓库与来源仓库限定为本次来源，私有仓库认证尚未接入页面。大型仓库的 PR 来源目录可能超出当前评价准备预算而失败，页面会显示失败而不是完整评价。建议使用当前会话完成或部分完成的评价结果。Windows 上执行修改需在 WSL 启动宿主；在 WSL 中可直接输入 Windows 盘符路径，由 `wslpath` 转换后仍须通过现有文件系统和沙箱检查。盘符路径转换成功不保证所有挂载布局都支持执行。

宿主保留的离线测试模型确定性地把单个文本文件替换为指定内容；它不理解任意自然语言，也不代表真实模型质量，普通对话界面不提供该诊断入口。检查命令由用户填写并审核；独立运行和固定 program checker 以实际候选与检查证据判断。未校准的结果不能作为强制 gate。命令仅能读取整个私有副本；网络、home、原始 Git 元数据、命令根级写入、硬费用、内存和文件读写字节限制均不支持。

选择目录前先输入需要排除的相对文件路径，排除先于正文读取。凭据检测无法识别所有可逆编码，排除敏感文件并逐次检查完整披露仍是必要边界。页面展示发现的现场、计划、独立权限和实际事件；计划确认不授予执行权限。执行后可单独允许本地显示差异，不等于向模型披露。原始工作树不会自动写回；不执行 commit、push、merge、release 或 deploy。刷新只显示当前内存状态，不补发断线事件；服务重启丢失会话和授权。
