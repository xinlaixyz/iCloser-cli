# 任务报告

## 基本信息

| 项目 | 值 |
|------|-----|
| 任务 ID | {{taskId}} |
| 任务描述 | {{description}} |
| 状态 | {{status}} |
| 优先级 | {{priority}} |
| 创建时间 | {{createdAt}} |
| 完成时间 | {{completedAt}} |
| 重试次数 | {{retryCount}} |

## 修改方案

{{#each plan.subGoals}}
- [{{status}}] **{{description}}**
  - 涉及文件：{{files}}
{{/each}}

## 修改文件清单

| 文件 | 意图 | 新增 | 删除 |
|------|------|------|------|
{{#each changes}}
| {{file}} | {{intent}} | +{{added}} | -{{removed}} |
{{/each}}

**总计：** 修改 {{changeCount}} 个文件，新增 {{totalAdded}} 行，删除 {{totalRemoved}} 行

## 修改推理

{{#each reasoning}}
### {{file}}
- **风险等级**：{{riskLevel}}
- **意图**：{{intent}}
- **推理**：{{reasoning}}
- **直接影响**：{{impact.directlyAffected}}
- **间接影响**：{{impact.indirectlyAffected}}
{{/each}}

## 验证结果

| 阶段 | 结果 | 耗时 | 详情 |
|------|------|------|------|
{{#each verifyResult.stages}}
| {{stage}} | {{status}} | {{duration}}ms | {{output}} |
{{/each}}

- **总体**：{{verifyResult.overall}}
- **测试**：{{verifyResult.passedTests}}/{{verifyResult.totalTests}} 通过
- **覆盖率**：行 {{verifyResult.coverage.lineCoverage}}% / 分支 {{verifyResult.coverage.branchCoverage}}%

## 门禁检查

- **结果**：{{gateResult.passed}}
{{#each gateResult.checks}}
- [{{status}}] {{name}} — {{detail}}
{{/each}}

{{#if gateResult.blocking}}
### 阻塞项
{{#each gateResult.blocking}}
- **{{name}}**：{{detail}}
  - 建议：{{suggestion}}
{{/each}}
{{/if}}

## 风险评估

- **整体风险**：{{riskLevel}}
{{#if highRiskChanges}}
- **高风险变更**：
{{#each highRiskChanges}}
  - {{file}}
{{/each}}
{{/if}}

## 回滚方法

```bash
ic rollback {{taskId}}
```
