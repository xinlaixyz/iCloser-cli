# Task: 任务主链补实 (S1/dev1)

**日期：** 2026-05-12
**执行者：** S1
**状态：** ✅ 完成
**类型：** enhancement / core

## 目标

把 `src/index.ts` 中所有 `simulate*` 占位函数替换为真实模块编排，让 `ic t/y/n/st/log/r/gate/mem/rule` 全部读写 `.icloser/tasks/<id>/` 的真实持久化数据。

## 改动文件

### `src/index.ts` — 完全重写（~470 行）

**删除：**
- `simulateTaskPlan()` — 关键字匹配假文件
- `simulateTaskExecution()` — 假文件变更 + 假验证
- `guessAffectedFiles()` — 硬编码文件映射

**新增核心函数：**
- `executeTask(task, config, rootPath, index)` — 完整 11 步任务执行管线：
  1. 文件锁获取 (acquireFileLocks)
  2. 上下文组装 (assembleContext)
  3. AI Provider 调用 (createProvider().chat)
  4. 代码块提取 (extractWriteBlocks)
  5. 文件写入 (writeFile)
  6. 修改推理记录 (addReasoning)
  7. Diff 生成 (getDiff → generateDiffFile)
  8. 验证执行 (runVerification)
  9. 报告生成 (generateTaskReport, generateReasoningFile)
  10. 记忆更新 (recordTask → saveProjectMemory)
  11. 清理收尾 (releaseFileLocks, updateTaskStatus, persistTask)

**新增输出辅助函数：**
- `printTaskPlan(task)` — 显示子目标 + 影响文件 + 风险等级
- `printTaskDetail(task)` — 显示任务完整状态（状态/描述/时间/修改/验证/错误）
- `printTaskList(tasks)` — 按状态排序显示任务列表
- `printGateResult(result, task)` — 显示 6 道门禁结果
- `statusLabel(status)` — 中文状态标签映射
- `extractWriteBlocks(content)` — 从 AI 响应提取 ```write:路径 代码块
- `buildSystemPrompt(config, index)` — 根据项目索引构造 AI 系统提示词

**CLI 命令全部接入真实数据：**

| 命令 | 改动前 | 改动后 |
|------|--------|--------|
| `ic t "描述"` | simulateTaskPlan → 假文件 | createTask → generatePlan → printTaskPlan → persistTask |
| `ic t "描述" --go` | simulateTaskExecution → 假执行 | executeTask → 11 步真实管线 |
| `ic y <id>` | 只打印消息 | loadTask → executeTask 完整执行 |
| `ic n <id>` | 只打印消息 | loadTask → git checkout → cancelTask → persistTask |
| `ic st [id]` | 硬编码 "completed" | listTasks/loadTask → 读取 .icloser/tasks/ |
| `ic d [id]` | 只显示 git diff | 读取 .icloser/tasks/<id>/diff.patch |
| `ic gate <id>` | 硬编码假结果 | runGateCheck → 真实 6 道门禁 |
| `ic log [id]` | "暂无历史任务" | listTasks 真实列表 / 读取 report.md |
| `ic r` | "暂无任务记录" | 找到最近 completed/failed 任务 → 读取 report.md |
| `ic mem [q]` | "0 条记录" | loadProjectMemory → 真实数据 + searchMemory |
| `ic rule` | "暂无自定义约束" | loadProjectMemory → addRule/removeRule 持久化 |
| `ic cancel <id>` | 只打印 | cancelTask → persistTask |

### `src/core/task-engine.ts` — 已有真实实现（无需改动）

- `createTask()` / `createTasks()` — 创建任务入队
- `generatePlan()` — 分解子目标 + 识别影响文件
- `acquireFileLocks()` / `releaseFileLocks()` — 文件冲突阻塞
- `updateTaskStatus()` / `addFileChange()` / `addReasoning()` / `setVerifyResult()`
- `persistTask()` → `.icloser/tasks/<id>/task.json`
- `loadTask()` / `listTasks()` — 读取持久化任务
- `cancelTask()` / `getQueue()` / `scheduleTasks()`

### `src/gate/checker.ts` — 已有真实实现（无需改动）

- `runGateCheck()` — 测试/安全/推理/报告/回滚/Git 六道门禁

### `src/report/generator.ts` — 已有真实实现（无需改动）

- `generateTaskReport()` → `report.md`
- `generateDiffFile()` → `diff.patch`
- `generateReasoningFile()` → `reasoning.md`
- `generatePRDescription()` → PR 描述

## 执行流程示例

```
$ ic t "给用户模块增加手机号登录"

[·] 解析任务：给用户模块增加手机号登录
[·] 任务 task-xxx 已创建
[·] 生成修改方案...

修改计划预览
  [ ] 数据模型/类型变更
      涉及：src/types/user.ts
  [ ] 业务逻辑修改
      涉及：src/auth/login.ts, src/auth/verify.ts
  [ ] API 接口变更
      涉及：src/api/auth.ts

  影响文件:
    ✎ src/types/user.ts
    ✎ src/auth/login.ts
    ✎ src/auth/verify.ts
    ✎ src/api/auth.ts

风险等级: 低

使用 ic y task-xxx 确认执行，ic n task-xxx 取消

$ ic y task-xxx

[·] 执行任务 task-xxx...
[·] 组装上下文... 1200 tokens (8% 预算)
[·] AI 执行中... Token 用量: 3,500
[✓] src/types/user.ts +12 行
[✓] src/auth/login.ts +45 行
[✓] src/auth/verify.ts +30 行
[✓] src/api/auth.ts +18 行
[·] 验证中...
[✓] 验证通过
[✓] 任务完成

报告目录：.icloser/tasks/task-xxx/
  report.md ✓
  diff.patch ✓
  reasoning.md ✓
  verify.log ✓

运行 ic gate task-xxx 执行门禁检查
```

## 验证

- TypeScript 编译通过：`npx tsc --noEmit` ✅
- 所有 CLI 命令路径不再引用 simulate* 函数
- 任务持久化到 `.icloser/tasks/<id>/task.json`
- 报告生成到 `.icloser/tasks/<id>/report.md`

## 对 dev2 的影响

无。dev2 的工作在 `detect.ts` / `scanner.ts` / `repl.ts` / `context.ts`，与本次改动正交。
index.ts 使用了 dev2 提供的 `loadConfig()` 和 `.icloser/index.json` 接口。
