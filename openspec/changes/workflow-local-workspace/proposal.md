# 可交互本地工作区与受控执行

## Why

Issue #68 要求用户实际选择个人 Git 工作区，审阅和调整计划，并明确授权后在独立隔离副本中修改和检查；静态页面或预设批准不能满足该目标。

## What Changes

- 新增仅本机访问的单用户页面和受信任宿主，直接组合既有 PlanningSession、ControlledExecutionSession、Linux sandbox 和公开 judge。
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
