# 投资报告分析超时与证据兜底修复

日期：2026-05-22  
状态：已修复  
范围：REPL 自然语言任务、工具循环、投资/市场分析报告

## 1. 真实问题

用户输入：

```text
你的投资报告分析太少了
```

真实运行中，系统完成了大量网页搜索和抓取：

- `web_search` 多次搜索 iCloser 投资、融资、估值、团队、Web3 等关键词。
- `web_fetch` 抓取 36氪、搜狐、官网等公开资料。
- 工具阶段累计 20 次调用，约 45K tokens。

但最终合成阶段 DeepSeek 超时，系统输出：

```text
分析超时:
deepseek API 请求超时
```

这属于严重体验问题：**工具已经拿到证据，但用户没有拿到报告。**

## 2. 根因

1. 单轮工具调用没有上限，模型可以一次请求大量 `web_search`。
2. Provider history 虽然做了单条截断，但没有全局长度上限。
3. 最终合成失败后，没有使用已有证据生成本地兜底报告。
4. Golden Path 把任务标记为失败，导致“取证完成但交付失败”。

## 3. 修复方案

### 3.1 工具限流

文件：`src/core/tool-loop.ts`

- 单轮最多执行 8 次工具调用。
- 单轮最多执行 5 次 `web_search`。
- 如果模型请求超过上限，系统注入提示：已限流，请基于已有证据输出最终报告。

### 3.2 上下文压缩

文件：`src/core/tool-loop.ts`

- 工具结果最大截断从 15000 字符降到 6000 字符。
- Provider history 增加全局上限 22000 字符。
- 工具结果进入 Provider 前只保留结构化摘要，不再把长网页全文反复塞入 history。

### 3.3 最终合成兜底

文件：`src/core/tool-loop.ts`

当最终 AI 合成超时，但已有成功工具证据时：

- 不再直接返回失败。
- 自动生成 `投资分析报告（证据兜底版）`。
- 报告包含：
  - 已确认信息
  - 投资判断框架
  - 需要补充的关键材料
  - 下一步建议
  - 证据概览
  - 兜底原因

### 3.4 回归测试

文件：`tests/agent-task-loop.test.ts`

新增测试：

```text
工具成功后，最终 AI 合成超时，也必须返回证据兜底报告。
```

验收点：

- `result.success === true`
- 输出包含 `投资分析报告`
- 输出包含 `证据兜底版`
- 输出包含 `需要补充的关键材料`
- Golden Path 状态为 `completed`

## 4. 验收命令

```powershell
npm test -- tests/agent-task-loop.test.ts
npm test -- tests/tool-loop.test.ts tests/p0-product-contract.test.ts tests/repl-ai-routing.test.ts
npm run build
```

当前结果：

- `agent-task-loop.test.ts`：7 个测试通过
- `tool-loop / p0-product-contract / repl-ai-routing`：18 个测试通过
- TypeScript 构建通过

## 5. 后续优化

- 为投资报告增加专用模板：市场、产品、团队、财务、竞品、风险、估值、尽调问题。
- 为网页研究任务增加“搜索计划”：先确定 5 个问题，再搜索，而不是任由模型散搜。
- 支持把公开证据自动沉淀成 `doc/research/` 报告文件。
