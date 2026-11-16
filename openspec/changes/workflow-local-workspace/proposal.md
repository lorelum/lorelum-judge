# 三项 Agent 功能的本地验收入口

## Why

用户需要配置真实模型并分别验收已实现的代码评价、评价后建议和未合并的计划与受控修改；项目工作区只是实际执行时所需的现场，不是全部功能的前置条件。

## What Changes

- 新增仅本机访问的单用户页面和受信任宿主，直接组合既有 PlanningSession、ControlledExecutionSession、Linux sandbox 和公开 judge。
- 页面显式选择代码/PR 评价、基于评价的修改建议或计划与受控修改；前两项调用已合并的公开 judge API，第三项复用既有工作流。
- 将本地发现、副本纳入及模型披露分开；计划调整的披露身份覆盖旧计划和新意见。集中审核但分别记录计划确认、文件权限、命令、模型披露和资源上限。
- 从真实操作检查点输出可安全投影的类型化会话事件；修复 UTF-8 输出字节预算。
- 支持确定性离线演示及宿主配置的真实 provider，不在未经明确授权时发送数据。

## Capabilities

### New Capabilities

- `workflow-local-workspace`: 本地交互、可信宿主、实时事件和受控工作区执行。

### Modified Capabilities

- `workflow-task-planning`: 规划请求的披露身份覆盖实际请求，包括调整意见和旧计划。
- `workflow-controlled-execution`: 暴露真实操作生命周期的类型化事件，并严格执行输出字节预算。

## Impact

Refs #68。依赖尚未合并的草稿 #64（d9a95413018b455c9b7343e43252cf795dfdfb73）和 #67（56c0794209277f34fa7906e5d5f63b9c8acd2be4）；不声称已发布。protocol 拥有跨边界事件，workflow 拥有操作语义，宿主拥有会话及安全投影，sandbox 拥有隔离。Benchmark 公开 starter 仅为可选项目；不接私有 evaluator、不创建正式 benchmark record，不自动写回或交付，不实现跨进程恢复。
