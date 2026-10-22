# 实施任务

## 1. 规划

- [x] 1.1 核对修订 Issue、固定主线和用户批准计划，建立独立工作树。
- [x] 1.2 完成 OpenSpec strict validation，建立同一长期规划 PR #62（规划提交 0524c7e）。

## 2. 契约与执行

- [x] 2.1 实现来源、计划、问题和报告的版本化公开契约与身份。
- [x] 2.2 实现 ReviewResult/v2 与 ReviewExecution/v2，接入已有执行与完整性校验；旧 API/identity/gate 保持行为。

## 3. 来源

- [x] 3.1 实现直接材料和位置映射。
- [x] 3.2 实现本地文件、目录、Git 选择、版本比较和一致性/权限边界。
- [x] 3.3 实现 GitHub 文件、目录、仓库、commit、compare、PR、Issue/意见实际读取与分页/截断处理。

## 4. 评价与报告

- [x] 4.1 实现公开 evaluateCode、任务整理、默认标准、要求保留及有限上下文补查。
- [x] 4.2 实现意见核实与复查、整体描述、问题和限制的结构化报告与中文渲染。
- [x] 4.3 接通 provider 真实传输与取消/失败，无隐式修补、重试或操作副作用。

## 5. 完成依据

- [x] 5.1 通过公开 exports 实际 smoke 23 个代表性来源/任务路径，包含实际有限补查（47 次本地 HTTP 模型请求）；只补必要的消费者可见边界回归。
- [x] 5.2 更新接入文档和消费示例；bun run validate 通过（717 tests、6 个 package build/Node ESM load、公开消费 smoke），OpenSpec strict validation 与 git diff --check 通过。未调用真实模型或 GitHub 网络，未证明真实模型评价质量。
- [ ] 5.3 核对范围和敏感内容，固定 SHA 独立审查并处理发现，更新同一 PR；不自动合并。
