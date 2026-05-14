# 验证报告

## 基本信息

| 项目 | 值 |
|------|-----|
| 任务 ID | {{taskId}} |
| 验证时间 | {{timestamp}} |
| 总体结果 | {{overall}} |
| 修复轮次 | {{attempts}} |
| 总耗时 | {{duration}} |

## 阶段详情

| 阶段 | 结果 | 耗时 | 输出 |
|------|------|------|------|
{{#each stages}}
| {{stage}} | {{status}} | {{duration}}ms | {{output}} |
{{/each}}

## 测试统计

- 总测试数：{{totalTests}}
- 通过：{{passedTests}}
- 失败：{{failedTests}}
- 跳过：{{skippedTests}}

## 覆盖率

- 行覆盖率：{{lineCoverage}}%
- 分支覆盖率：{{branchCoverage}}%
- 覆盖行数：{{coveredLines}} / {{totalLines}}

## 失败详情

{{#if failures}}
{{#each failures}}
### {{stage}}
```
{{errorDetails}}
```
{{/each}}
{{else}}
无失败项
{{/if}}

## 不稳定测试

{{#if flakyTests}}
{{#each flakyTests}}
- {{name}} — 连续失败 {{count}} 次
{{/each}}
{{else}}
无不稳定测试
{{/if}}
