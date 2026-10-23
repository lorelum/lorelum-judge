# 独立代码评价

## Why

Issue #60 已收敛为定性代码评价。现有 review 需要调用方准备 definition 和 evidence，不能从代码、路径或 PR 自行组织上下文，也没有结构化问题位置及用户报告。本 change 补齐高层 package API，复用 #10/#51 执行，不建设评分或修改工作流。

## What Changes

- 接收直接材料、本地文件/Git 与 GitHub 来源，固定版本、双侧位置及实际覆盖范围。
- 提供 evaluateCode 与中文报告渲染，支持代码检查、仓库概览、变更、对照要求、意见核实和复查。
- 在授权与资源限制内补查上下文，准备阶段与正式评价分别记录。
- 新增来源快照、计划、报告及 ReviewResult/v2、ReviewExecution/v2，保留既有 verdict、measurement、calibration、gate 含义。
- 实际接通模型传输、引用校验及部分结果，失败不冒充干净结论。

## Scope and Non-goals

覆盖 Issue #60 全部任务及首批来源。仓库概览是显式限定范围的检查，不是全面审计。无评分、CLI/Web、数据库、自动重试、具体修复方案、文件修改、GitHub 写入、#52 或交付。开发中的正常构建验证不属于产品执行权限。

## Dependencies and Delivery

Refs #60。基线 fdbfcb1ecd8debc770563f41e3f2f7986335b3b6；独立 codex/judge-code-evaluation 工作树。先 strict validation 和 OpenSpec-first PR，再在同一分支完成实现。复用现有验证入口和消费示例，不建设额外验证平台。用户已批准实施计划；不授权真实收费模型、合并或发布。
