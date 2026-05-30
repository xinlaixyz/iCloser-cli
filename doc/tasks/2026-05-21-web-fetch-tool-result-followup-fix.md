# 网页抓取工具结果与追问修复

日期：2026-05-21

## 一、问题

用户实测流程：

1. 让 iCloser 访问 `https://icloser.asia/`。
2. 工具面板显示 `web_fetch` 已经成功，并返回了网页标题。
3. 最终回答却仍然说“让我访问这个网址看看内容”，没有解释抓取到的网页。
4. 用户追问“具体是什么呀”后，AI 又错误地转去读取本地项目文件。

## 二、根因

OpenAI 兼容协议的模型服务路径在构造用户消息时没有包含 `prompt.history`。

工具循环已经把结果写入历史，例如 `[工具(web_fetch)] ...`，但 DeepSeek / OpenAI / Qwen 的请求体没有把这段历史发送给模型。结果就是：工具确实执行了，但 AI 合成答案时看不到工具结果。

REPL 还缺少对模糊追问的本地保护。当用户问“具体是什么呀”时，模型可能把它当成一个新的项目问题，于是调用代码读取工具，导致话题跑偏。

## 三、修复

- 新增 `buildOpenAICompatibleUserContent()`，把 `prompt.history` 放到 `## 对话与工具历史` 中。
- 将成功的工具证据写入 assistant 对话记录，覆盖 `web_fetch`、`web_search`、`read_file`、`get_project_overview`。
- 在 REPL 会话状态中新增 `lastToolEvidence`。
- “具体是什么呀”“详细点”等模糊追问会复用上一轮工具证据，避免注入无关本地代码片段。
- 增加确定性兜底：如果 `web_fetch` 成功后模型仍输出“让我访问看看”这类过程话术，CLI 会直接根据工具结果合成回答。

## 四、验收结果

- `npx tsc --noEmit` 通过。
- `npx vitest run tests\provider.test.ts tests\repl-ai-routing.test.ts tests\tool-loop.test.ts tests\repl-tool-viz.test.ts` 通过，共 63 个测试。
- `npm run build` 通过。
- `npm run lint` 通过。

## 五、产品影响

这次修复补上了 Claude Code 对标中的核心缺口：工具结果必须对 AI 可见，也必须能被下一轮追问继续使用。

以后只要工具调用成功，就不能再出现“我去看看”这种空回答。
