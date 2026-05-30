# DeepSeek 工具循环请求体转义修复

日期：2026-05-21

## 一、实测问题

用户在真实项目中输入代码修改任务后，AI 已经能调用工具读取项目证据，但第二轮请求 DeepSeek 失败：

```text
AI 调用失败: deepseek API 调用失败: 400 Failed to parse the request body as JSON:
messages[1].content: unexpected end of hex escape
```

典型触发内容包括：

- Windows 路径：`D:\temp\Codex\...`
- 正则搜索：`/1\.0[^0-9]/`
- HTML/CSS/脚本片段中的反斜杠内容
- 工具结果被拼进下一轮 `history`

## 二、根因

工具循环会把 `search_code`、`read_file` 等结果拼入下一轮模型消息。DeepSeek 对消息内容里的反斜杠序列更敏感，遇到 `\x`、Windows 路径、正则反斜杠时可能把内容解释为非法转义，从而在服务端拒绝整个请求体。

这不是用户 API Key 输入错误，也不是“默认走 OpenAI”。当前 DeepSeek 使用的是 OpenAI 兼容协议，但 Provider 仍然是 DeepSeek。

同时，Golden Path 面板存在误导：即使 AI 调用失败，也会把“形成结论”和“验证证据”显示为完成。

## 三、修复内容

### 1. DeepSeek 出站消息净化

新增 `sanitizeDeepSeekMessageContent()`，并在复测后升级为更保守的净化策略：

- 替换异常 Unicode 代理字符。
- 移除不可见控制字符。
- 将反斜杠替换为 `/`，避免 `\x`、`\t`、`\u`、Windows 路径和正则转义在 DeepSeek 服务端被误判为非法转义。

该净化只在 `DeepSeekProvider` 出站消息中启用，不影响 Mock、Claude、OpenAI、Qwen 的常规路径。

涉及文件：

- `src/ai/provider.ts`

### 2. Golden Path 失败态修正

`renderGoldenPathPanel()` 现在会识别：

- `success=false`
- `AI 调用失败`
- `分析超时`

出现这些情况时：

- “形成结论”显示为失败。
- “验证证据”显示为需注意。
- 面板增加失败摘要。
- 不再把失败文本伪装成完整结论。

涉及文件：

- `src/cli/repl.ts`

### 3. 回归测试

新增测试覆盖：

- DeepSeek 消息中包含 Windows 路径、正则、`\x` 时会被安全转义。
- AI 调用失败后 Golden Path 不再显示“形成结论完成”。

涉及文件：

- `tests/provider.test.ts`
- `tests/repl-ai-routing.test.ts`

## 四、验收命令

```bash
npx vitest run tests\provider.test.ts tests\repl-ai-routing.test.ts
npx tsc --noEmit
npm run lint
```

结果：

- 2 个测试文件通过。
- 35 个定向测试通过。
- TypeScript 类型检查通过。
- lint 通过。

## 五、产品影响

本次修复直接影响“实际测试修改代码能力”：

- 工具结果可以继续进入 DeepSeek 下一轮分析。
- Windows 项目路径和正则搜索不再高概率打断 AI。
- AI 失败时，用户会看到真实失败状态，而不是一个看似完成的 Golden Path。

后续还需要继续实测完整代码修改链路：

1. `TradGPT -> AgentFI` 更名。
2. iOS 版本号 `1.0 -> 1.10`。
3. 新增 VA Banking 帮助页。

这三项必须在真实项目里完成 diff、写入、验证和最终报告，才能算代码交付体验继续加分。
