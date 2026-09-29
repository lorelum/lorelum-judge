# 安全策略

## 报告方式

不要为可能暴露凭据、仓库内容、执行环境或模型输入的漏洞创建公开 issue。请私下联系维护者，
并提供：

- 受影响的 package、commit 和运行环境；
- 最小复现步骤或 proof of concept；
- 预期影响；
- 未可信 task、repository、log 或 model content 是否能够触发。

## 安全敏感区域

prompt injection 边界、tool approval、路径授权、命令执行、凭据隔离、evidence 脱敏、
cache identity，以及持久化 contract 的反序列化。
