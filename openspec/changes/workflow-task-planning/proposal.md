# 任务计划与明确确认

## Why

Issue #52 要求在工程修改之前组织来源、任务标准和修改方案，交用户审阅并明确确认。现有代码评价与建议不是工程计划或授权，workflow 入口仍为空。

## What Changes

- 从用户任务和带版本定位的资料生成可审阅计划，追溯每项完成标准。
- 支持调整、重新提出、明确确认、撤销和失效，并绑定完整计划身份。
- 区分计划确认、实际操作授权以及资料缺失和必须用户取舍的冲突。
- 建立 #11 阶段 A–H 的共同设计入口；B/C 消费已确认计划。

## Capabilities

### New Capabilities

- `workflow-task-planning`: 可追溯的工程计划生成与确认。

### Modified Capabilities

无。

## Impact

Refs #52。公开跨边界记录归 protocol，计划生成及状态转换归 workflow。修改执行、隔离、独立取证和闭环分属 #53、#54，本 change 不实现；确认计划不授权任何操作。
