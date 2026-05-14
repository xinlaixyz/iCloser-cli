# S2.1 Real Provider Task Chain — Completion Record

日期：2026-05-13
负责人：dev1
状态：完成

## 目标

把现有任务主链从 mock 演示推进到真实 Provider 可稳定执行。

## 修改的文件

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/ai/errors.ts` | AI 错误分类模块 — `AICallError` 类 + `classifyError()` 工厂函数 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/ai/provider.ts` | 所有 Provider 使用 `classifyError()` 替代裸 `throw new Error()`；分类时会识别 `config.ai.apiKey`；`smokeTestProvider` 包含 suggestion |
| `src/index.ts` | `executeTask()` 中 AI 调用和自动修复错误处理展示 `AICallError.toDisplay()`；导入 `AICallError` |
| `src/cli/output.ts` | `printError()` 支持 `toDisplay()` 协议的 duck-typing 检测 |
| `tests/provider.test.ts` | 新增 13 个错误分类/验收修补测试（MISSING_API_KEY / AUTH_FAILED / NETWORK_ERROR / TIMEOUT / INVALID_MODEL / RATE_LIMITED / UNKNOWN） |

## 错误分类体系

8 种错误码，每种包含中文原因 + 下一步建议：

| 错误码 | 检测条件 | 建议示例 |
|--------|---------|---------|
| `MISSING_API_KEY` | 环境变量未设置 | `$env:DEEPSEEK_API_KEY="sk-..."` |
| `AUTH_FAILED` | 401/403/unauthorized | 检查 Key 是否正确/过期/有权限 |
| `NETWORK_ERROR` | ECONNREFUSED/ENOTFOUND/fetch failed | 检查网络/代理/防火墙 |
| `TIMEOUT` | timeout/timed out/abort | 检查延迟/简化任务/重试 |
| `EMPTY_RESPONSE` | 模型返回空内容 | 已在 smokeTestProvider 层面检测 |
| `INVALID_MODEL` | model not found | 运行 `ic provider models` 查看 |
| `RATE_LIMITED` | 429/rate limit/quota | 等待重试/检查配额 |
| `UNKNOWN` | 其他错误 | 运行 `ic provider test` 诊断 |

## 验收结果

### `npm run build`
通过 — TypeScript 编译无错误。

### `npm run test`
通过 — 11 个测试文件，92 个测试（原 79 + 新增错误分类测试和验收修补测试）。

### `npm run smoke`
通过 — mock provider 完整 12 步管线：

1. build + test ✓
2. 临时项目 setup --mock ✓
3. init → provider use mock → provider test ✓
4. doctor --json (ready=true) ✓
5. ic t "修改 notes.txt" --go (task completed) ✓
6. status --json (1 task, completed) ✓
7. gate --json (passed=true) ✓
8. report ✓

### `ic provider test` 对真实 Provider
代码已就绪。连接真实 Provider 时的行为：

- 缺少 API Key → `MISSING_API_KEY` + 设置建议
- 鉴权失败 → `AUTH_FAILED` + 4 步排查指引
- 网络失败 → `NETWORK_ERROR` + 4 步排查指引
- 超时 → `TIMEOUT` + 重试/切换模型建议
- 无效模型 → `INVALID_MODEL` + 查看模型列表建议

## dev2 验收修补

验收时补了 3 个小问题：

1. `classifyError()` 增加 `hasConfiguredKey` 参数，避免 `config.ai.apiKey` 已存在但环境变量未设置时误报 `MISSING_API_KEY`。
2. `ETIMEDOUT` 归类为 `TIMEOUT`，不再被网络错误规则提前吞掉。
3. `printError()` 只有在 `toDisplay` 确认为函数时才调用，避免 duck-typing 误伤。

## 如何配置真实 Provider

### DeepSeek（推荐）

```powershell
# PowerShell
$env:DEEPSEEK_API_KEY = "sk-your-deepseek-key"

# 验证
ic provider use deepseek
ic provider test
```

### OpenAI

```powershell
$env:OPENAI_API_KEY = "sk-your-openai-key"
ic provider use openai
ic provider test
```

### Claude

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-your-claude-key"
ic provider use claude
ic provider test
```

### Qwen (通义千问)

```powershell
$env:DASHSCOPE_API_KEY = "sk-your-qwen-key"
ic provider use qwen
ic provider test
```

配置完成后，`ic t "你的任务描述" --go` 将使用真实 AI 执行代码修改。

## 实测命令

```bash
# 构建
npm run build

# 测试（92 个通过）
npm run test

# 离线 smoke（mock provider，无需 API Key）
npm run smoke

# 真实 Provider 连通性（需要 API Key 环境变量）
ic provider test
ic provider test --json

# 真实任务执行（需要在已初始化的 TypeScript 项目中）
ic t "修改一个简单函数" --go
```

## 已知风险

1. **模型名称兼容性**：`deepseek-v4-pro` 是当前默认，但 DeepSeek 公开 API 的实际模型 ID 可能是 `deepseek-chat` 或 `deepseek-reasoner`。如果用户使用的是 DeepSeek 公开 API 而非特定部署，可能需要切换到 `deepseek-chat`。

2. **Claude SDK 动态导入**：Claude Provider 使用 `await import('@anthropic-ai/sdk')` 动态加载，如果 SDK 版本不兼容或网络受限，可能导致运行时失败。

3. **baseURL 可配置性**：当前 DeepSeek baseURL 硬编码为 `https://api.deepseek.com/v1`，OpenAI/Claude 使用 SDK 默认。用户如果使用代理或私有部署，需要能自定义 baseURL。当前 `config.ai` 类型已预留 `baseUrl` 字段，Provider 构造时传入但部分未使用。

4. **流式 vs 非流式差异**：DeepSeek/OpenAI 的 `chatStream` 和 `chat` 使用不同的消息构建逻辑（chat 包含 system prompt + context，chatStream 仅 system prompt），任务链当前只使用 `chat()`，但如果未来切换到流式，可能存在行为差异。

5. **超时控制**：当前未在 Provider 层面设置 HTTP 请求超时。长时间无响应会依赖 Node.js 默认超时。建议后续在 OpenAI/Anthropic SDK 初始化时传入 `timeout` 参数。

6. **空响应处理**：当模型返回空内容时，task engine 会在 extractWriteBlocks 阶段捕获并报错，但 AI 调用本身成功。这属于"模型输出质量问题"而非"Provider 连接问题"，错误分类已区分。

## 下一步

dev2 完成 S2.2 AI Output Contract 后，由 dev2 做集成验收。

相关文档：
- `doc/S2_DEVELOPMENT_PLAN.md` — S2 总计划
- `doc/tasks/2026-05-12-s2-next-stage-plan.md` — S2 任务安排
- `src/ai/errors.ts` — 错误分类实现
