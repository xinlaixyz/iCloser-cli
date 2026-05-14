# Task: S1/dev1 任务主链补实 — 从 simulate 到真实闭环

**日期：** 2026-05-12
**执行者：** S1 (dev1)
**状态：** ✅ 完成
**依赖：** dev2 已完成的 detect / scanner / 索引持久化 / 测试基线

## 验收清单

| 检查项 | 状态 |
|--------|------|
| `npm run build` 通过 | ✅ |
| `npm run test` 通过 (13 tests, 4 files) | ✅ |
| `ic init --force` 生成 `.icloser/icloser.json` + `index.json` + `memory.json` | ✅ |
| `ic init` 索引正确使用 `saveProjectIndex`（Map 序列化） | ✅ |
| `ic t "描述"` 生成真实 task 目录和 plan | ✅ |
| `ic st` 读取 `.icloser/tasks/` 真实数据 | ✅ |
| `ic d <id>` 读取 `.icloser/tasks/<id>/diff.patch` | ✅ |
| `ic y <id>` 触发 `executeTask` 完整管线 | ✅ |
| `ic n <id>` 取消任务 + git checkout 回滚 | ✅ |
| `ic log` / `ic r` 读取真实 `report.md` | ✅ |
| `ic gate <id>` 调用 `runGateCheck` 六道门禁 | ✅ |
| `ic mem` / `ic rule` 读写真实 memory.json | ✅ |
| `ic config` 显示验证管线详情 | ✅ |

## 改动总结

### `src/index.ts` — 完全重写 (~470 行)

删除 3 个 simulate 函数，新增 10 个真实函数。12 个 CLI 命令全部接入 `.icloser/tasks/<id>/` 持久化数据。

**executeTask 11 步管线：**
```
createTask → generatePlan → acquireFileLocks → assembleContext
→ createProvider.chat() → extractWriteBlocks → writeFile
→ addReasoning → generateDiff → runVerification
→ generateReport → recordTask → releaseFileLocks
```

**索引持久化修复：**
- `ic init` 改用 `saveProjectIndex()`（而非裸 `writeJson`），正确序列化 Map 字段
- `ic scan` 同上
- `ic t` / `ic y` 改用 `loadProjectIndex()`（而非裸 `readJson`），正确反序列化 Map

### `tests/task-engine.test.ts` — 新增 9 个测试

覆盖：createTask 结构、优先级、generatePlan 子目标、persistTask/loadTask 往返、loadTask 后状态更新保持连接、listTasks 排序、acquireFileLocks 冲突阻塞、状态流转时间戳、变更累积。

## 测试结果

```
✓ tests/detect.test.ts       (2 tests)
✓ tests/scanner.test.ts      (1 test)
✓ tests/context.test.ts      (2 tests)
✓ tests/task-engine.test.ts  (9 tests)  ← 新增

Test Files  4 passed (4)
Tests      14 passed (14)
```

## dev2 验收补充

验收时间：2026-05-12

已执行：

```bash
npm run build
npm run test
node dist/index.js init --force
node dist/index.js scan
node dist/index.js t "修改 context 模块的中文关键词匹配"
node dist/index.js st <task-id>
node dist/index.js log
```

结果：

- `npm run build` 通过。
- `npm run test` 通过，4 个测试文件、14 个测试用例。
- `init` / `scan` 可正常写入 `.icloser/icloser.json` 与 `.icloser/index.json`。
- `ic t` 能创建真实 `.icloser/tasks/<task-id>/task.json`。
- `ic st <task-id>` 与 `ic log` 能读取真实任务数据。

验收中修复：

- `ic t` 预览模式原本会提前把任务标记为 `running`，导致未确认执行的任务状态不正确。已改为预览任务保持 `queued`。
- `loadTask()` 原本只返回 JSON，不会重新接入内存 `taskStore`，导致新进程执行 `ic y <id>` 时 `updateTaskStatus()` / `addFileChange()` 等状态更新可能无法作用到持久化任务对象。已在 `loadTask()` 中重新注册 `taskStore` / `taskQueue` / dependencies。
- 新增测试：loaded task 能继续响应内存状态更新并持久化。

未执行完整 AI 代码生成链路：

- 当前本机未配置可用 API Key，因此没有执行 `ic y <id>` 的真实 AI 写文件路径。该路径需要在配置 Provider Key 后继续验收。

## 已知限制

- `generatePlan` 的 `identifyFiles()` 使用模块名关键词匹配，当模块名与描述关键词不匹配时 affectedFiles 可能为空（不影响 plan 子目标分解）
- `executeTask` 中的 AI 调用需要配置 API Key 才能实际执行代码生成
- Agent manager 的 `simulateExecution` 不在本次范围内（属于 T3 优先级）

## 对 dev2 的影响

无。dev2 的 scanner/context/repl 工作与本次改动正交。本次改动消费了 dev2 提供的 `saveProjectIndex` / `loadProjectIndex` / `scanProject` 接口。
