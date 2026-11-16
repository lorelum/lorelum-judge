# 本地工作区

开发中的 #68 草稿入口，依赖未合并的 #64 / #67；不表示正式发布。仅本机单用户访问；模型、项目和沙箱权限留在宿主。首批安全发现和执行需要支持 `openat2`、bubblewrap 与必要 namespace 的 Linux。请先阅读 `packages/runtime-bubblewrap/README.md` 中的工具链、mount、权限和共享内核边界。

## 准备与运行

使用 Bun 1.4.2 和 Node 22.21.0。在已获 `lorelum/lumen-ui` 私有仓库读取权限的环境：

```sh
bun run prepare:lumen
bun install --frozen-lockfile
bun run workspace:local
```

准备脚本将组件库固定在 `b95a5409bfaba0e0f8db65c7a82257425f2ca99e`，在忽略的 `.lumen-cache/` 中构建本地包；不提交组件源码或包产物。公开仓库的 CI 需要 `LUMEN_UI_READ_TOKEN` secret 读取该私有仓库；未配置时 CI 无法准备页面依赖。外部消费者也需要组件库读取权限。离线演示运行时不调用外部服务；首次准备依赖仍需要仓库访问与包安装。

公开 fork 的 pull request 默认拿不到上游仓库的 Actions secrets，因此上述 CI 步骤也不能读取私有组件库；不要使用 `pull_request_target` 或向不可信代码暴露 token 来绕过该限制。

宿主默认只监听随机 loopback 端口；可用 `LORELUM_WORKSPACE_PORT` 指定端口。真实模型可在启动环境设置 `LORELUM_MODEL_ENDPOINT` 和 `LORELUM_MODEL_NAME`，需要时单独设置 `LORELUM_MODEL_API_KEY`。不要将密钥放入命令历史、仓库或页面。仅配置和选择模型不会发出请求；页面会在每次规划前展示接收方及完整披露范围并要求明确同意。执行中资料披露另行授权。未配置或真实请求失败时不会静默回退到离线模型。

离线模型确定性地把用户选择的单个文本文件替换为用户提供的内容；它不理解任意自然语言，也不代表真实模型质量。检查命令由用户填写并审核；独立运行和固定 program checker 以实际候选与检查证据判断。未校准的结果不能作为强制 gate。命令仅能读取整个私有副本；网络、home、原始 Git 元数据、命令根级写入、硬费用、内存和文件读写字节限制均不支持。

选择目录前先输入需要排除的相对文件路径，排除先于正文读取。页面展示发现的现场、计划、独立权限和实际事件；计划确认不授予执行权限。执行后可单独允许本地显示差异，不等于向模型披露。原始工作树不会自动写回；不执行 commit、push、merge、release 或 deploy。刷新只显示当前内存状态，不补发断线事件；服务重启丢失会话和授权。
