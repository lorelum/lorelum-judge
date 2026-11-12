# 计划审核后的受控工程闭环

## Why

Issue #65 需要用户审核计划后，系统在明确授权范围内真正修改隔离副本、独立取证、调用公开 judge 并报告。#64 只提供计划能力，不提供执行权限、隔离或闭环。

## What Changes

- 复用 #64 的版本化计划和确认，分别审核操作权限、资料披露与可实施的资源上限。
- 从明确确认的项目现场建立起点和隔离副本，执行受控修改与检查；支持的平台必须实际阻断越权，无法落实时拒绝。
- 从冻结代码状态独立取证，消费现有公开 judge 结果，分开报告质量、完整性、执行资格及未知项。

## Capabilities

### New Capabilities

- `workflow-controlled-execution`: 经确认计划驱动的受控单次工程闭环。

### Modified Capabilities

无。

## Impact

Refs #65；依赖草稿 #64 的完整提交及后续 review，不宣称其已合并。protocol 拥有版本化跨边界记录，workflow 编排，runtime adapter 提供 Linux 隔离，judge 保持公开测量语义。无自动写回、交付、重启恢复或长期修复循环。
