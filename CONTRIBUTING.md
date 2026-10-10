# 贡献指南

## 开发环境

仓库使用 Bun 1.4.2 和 Node 22.21.0（`check:dist` 在 Node ESM 下加载构建产物），并在根目录提供唯一验证入口：

```sh
bun install --frozen-lockfile
bun run validate
```

本地命令必须与 `.github/workflows/validate.yml` 使用相同的包管理器和验证入口。

## 协作语言

面向协作者的 issue、PR 和 review 评论默认使用中文。文件路径、命令、代码标识符、日志和
错误信息保持原文，便于搜索和复核。

## 变更门禁

- `main` 只通过 PR 变更，每个 PR 只声明一个问题或边界。
- 公共 schema、package interface、runtime contract、评测 semantics、持久化 record 或
  流水线 gate 的变更必须先有收敛的 issue，再创建 `openspec/changes/<change-name>/`。
- 一个 change 使用一个长期分支和一个 PR。分支先提交 OpenSpec artifacts，使设计可在实现前
  审阅；实现、验证和任务勾选继续提交到同一分支和同一 PR，不为同一 change 另开实现 PR。
- 不改变 contract 的文档或工具修正可以直接提 PR，但正文必须说明根因、修复边界和验证方式。
- 每项 `tasks.md` 工作完成后立即勾选，并在 PR 中保留实际命令和结果。

## PR 要求

- 标题使用 Conventional Commits。
- PR 正文必须让未阅读聊天上下文的 reviewer 能回答“改了什么、怎样验证、有哪些延期”。
- 逐字列出实际运行的命令、测试场景和结果，不使用“本地已测试”代替证据。
- 使用 AI 编写、测试或 review 时，披露参与范围和 AI review findings 的处理结果。
- review 期间通过追加 commit 处理反馈，不重写已经发布的提交历史。

## 安全

不要在 issue、PR、日志、fixture 或提交中放入真实 token、密钥、内部地址或个人信息。安全
问题按 `SECURITY.md` 私下报告。
