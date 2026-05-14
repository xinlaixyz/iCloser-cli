# 2026-05-12 S1 离线验收：Mock Provider

## 背景

真实 `ic y <task-id>` / `ic t --go` 主链需要 AI Provider API Key。当前开发机未配置可用 Key，导致完整写文件链路无法稳定自动验收。

为解除这个阻塞，新增内置 `mock` provider，用本地确定性输出模拟 AI 返回 `write:路径` 代码块。

## 改动

### `src/types.ts`

- `AIProvider` 新增 `'mock'`。

### `src/ai/provider.ts`

- `createProvider()` 支持 `mock`。
- `getAvailableProviders()` 列出 `Mock (offline test)`。
- 新增 `MockProvider`：
  - 不调用网络。
  - 不需要 API Key。
  - 支持 `chat()` / `chatStream()`。
  - 优先从任务描述中提取显式文件路径。
  - 如果任务未写路径，则使用 `ContextPackage.relevantCode` 中的最高相关文件。
  - 输出标准：

````text
```write:path/to/file
...
```
````

### `src/config.ts`

- `setAIProvider()` 支持 `mock → mock-offline`。
- `defaultConfig()` 支持 `ICLOSER_AI_PROVIDER=mock` 时默认模型为 `mock-offline`。

### `src/index.ts`

验收中修复报告状态：

- 原来 `report.md` 在最终状态更新前生成，报告中状态可能仍是 `running`。
- 现在验证结束后先设置 `completed/failed`，再生成报告和记忆。

### `src/core/task-engine.ts`

验收中修复任务时间排序稳定性：

- `createTask()` 使用单调递增 timestamp，避免同毫秒创建任务导致 `listTasks()` 排序 flaky。

## 测试

新增 `tests/provider.test.ts`：

- mock provider 可以从 relevant context 生成 deterministic `write:` 代码块。
- mock provider 出现在 available providers 列表中。

全量结果：

```bash
npm run build
npm run test
```

- 5 个测试文件通过。
- 16 个测试用例通过。

## 端到端验收

临时项目：`C:\tmp\icloser-mock-e2e-2`

执行：

```powershell
$env:ICLOSER_AI_PROVIDER = "mock"
node D:\temp\Codex\AgentCode\dist\index.js init --force
node D:\temp\Codex\AgentCode\dist\index.js t "修改 notes.txt 添加离线验收标记" --go
node D:\temp\Codex\AgentCode\dist\index.js st <task-id>
```

结果：

- `notes.txt` 被写入 mock 修改标记。
- `.icloser/tasks/<task-id>/task.json` 状态为 `completed`。
- `report.md` 生成且状态为 `completed`。
- `reasoning.md` 生成。
- `.icloser/memory.json` 写入。

## 使用方式

```powershell
$env:ICLOSER_AI_PROVIDER = "mock"
iCloser init --force
iCloser t "修改 notes.txt 添加离线验收标记" --go
```

或项目内：

```bash
iCloser config provider mock
iCloser t "修改 path/to/file.ts 添加离线验收标记" --go
```

## 限制

- mock provider 只用于验证主链行为，不代表真实 AI 代码质量。
- 它只做确定性轻量修改，不做真实需求理解。
- 若任务未显式写文件路径，依赖 context 相关性命中第一个完整代码片段。
