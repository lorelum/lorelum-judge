## ADDED Requirements

### Requirement: 可观察的真实执行
执行 SHALL 在实际操作检查点提供类型化动作提出、授权决定、开始、结果、检查和终止通知，不从最终结果构造不存在的历史。

#### Scenario: 动作被拒绝
- **WHEN** 受控动作未通过授权
- **THEN** 系统报告拒绝且不执行该动作

### Requirement: 返回输出字节预算
stdout 与 stderr 返回字符串的 UTF-8 字节数合计 SHALL 不超过共享输出预算，并 SHALL 保留真实截断状态。

#### Scenario: 多字节字符跨预算边界
- **WHEN** 预算在 UTF-8 字符中间耗尽
- **THEN** 返回的字符串仍满足字节预算且不将截断表示为成功
