# AgentTaskLoop 主链路重构验收记录

日期：2026-05-21

## 一、目标

把 iCloser 从“散装工具集合”推进为统一的 AI 工程任务主链路。用户输入自然语言后，系统必须经过同一套任务循环，而不是 REPL、tool-loop、orchestrator、task-engine 各跑一套。

目标主路径：

```text
用户一句话
-> 识别任务类型
-> 建立任务状态
-> 调用工具
-> 结构化证据
-> 生成结果或代码补丁
-> diff / 写入 / 验证
-> 最终报告
-> 记忆沉淀
```

## 二、任务完成情况

| 优先级 | 任务 | 完成情况 | 落地文件 |
|---|---|---|---|
| P0-1 | 统一 AgentTaskLoop | 已新增统一主循环，REPL 工具任务已切入该循环 | `src/core/agent-task-loop.ts`、`src/cli/repl.ts` |
| P0-2 | Provider Gateway | 已新增 Provider 网关，对 prompt/history/context 做统一净化与裁剪 | `src/ai/provider-gateway.ts` |
| P0-3 | Evidence Store | 已新增结构化证据存储，工具结果先摘要再进入 Provider 上下文 | `src/core/evidence-store.ts`、`src/core/tool-loop.ts` |
| P0-4 | Golden Path 状态机 | 已新增状态对象与渲染，不再只靠展示函数猜状态 | `src/core/golden-path-state.ts` |
| P0-5 | Code Delivery Pipeline | 已新增代码交付解析与补丁生成流程；REPL 可接回 diff/write 面板 | `src/core/code-delivery-pipeline.ts`、`src/cli/repl.ts` |
| P1-1 | 继续任务恢复 | “继续/继续任务”等追问会复用上一轮结构化证据 | `src/cli/repl.ts`、`src/core/agent-task-loop.ts` |
| P1-2 | 三个真实样板任务 | 已纳入验收标准；仍需在真实项目重新跑完整记录 | `doc/GOLDEN_PATH_AND_SCORE_ACCEPTANCE_2026-05-21.md` |
| P1-3 | 记忆接入任务开始/结束 | 主循环支持 preload memory，并在状态中标记采用记忆 | `src/core/agent-task-loop.ts` |
| P1-4 | README/help 产品化 | README 已中文化分组，help 已补主路径与命令分组 | `README.md`、`doc/help.md` |

## 三、关键架构变化

### 1. AgentTaskLoop

新增 `runAgentTaskLoop()`，统一处理：

- 任务类型识别：网页、启动、代码、分析、发布、记忆、通用。
- 工具调用：复用现有工具定义和 `runToolLoop()`。
- 证据落库：工具结果进入 `EvidenceStore`。
- 状态推进：输出 `GoldenPathState`。
- 代码交付：代码任务尝试解析或补生成结构化 patch。

### 2. Provider Gateway

新增 `ProviderGateway`，所有 REPL 工具任务通过网关调用 Provider：

- 清理控制字符。
- 统一 Windows 路径斜杠。
- 裁剪 history、task、projectMeta、memory、源码片段。
- 避免把超长工具结果原样塞给 DeepSeek / OpenAI / Claude。
- 增加 Provider 调用超时，真实模型卡住时主链路会失败返回，而不是无限等待。

### 3. Evidence Store

工具结果不再作为大段 raw history 进入模型，而是变成结构化记录：

```json
{
  "kind": "tool",
  "source": "read_file",
  "target": "index.html",
  "status": "success",
  "summary": "摘要内容"
}
```

默认写入：

```text
.icloser/agent-tasks/<task-id>/evidence.json
```

### 4. Golden Path 状态机

Golden Path 不再只看 “有没有 finalResponse”，而是看真实状态：

- `failed`：形成结论失败。
- `patch_ready`：代码补丁已生成，等待 diff/write。
- `completed`：任务完成。
- `blocked`：等待用户或环境动作。

### 5. Code Delivery Pipeline

代码任务必须追求结构化输出：

```json
{
  "summary": "...",
  "changes": [
    {
      "file": "相对路径",
      "operation": "write",
      "content": "完整文件内容",
      "reasoning": "..."
    }
  ]
}
```

REPL 收到 `patch-ready` 后，会把变更转换为 pending files，并进入现有 diff/write 确认面板。

## 四、验收命令

```bash
npx vitest run tests\agent-task-loop.test.ts tests\tool-loop.test.ts tests\repl-ai-routing.test.ts tests\provider.test.ts
npx tsc --noEmit
```

当前结果：

- 4 个定向测试文件通过。
- 43 个测试通过。
- TypeScript 类型检查通过。

## 五、仍需真实复测

这次属于主链路代码级重构，真实体验分必须靠下面三个样板任务复测：

1. 网页访问与追问：`https://icloser.asia/`，追问“具体是什么呀”。
2. Android / App 需求转 H5 网页：输入移动端需求，产出可运行 H5 页面并给出浏览器验收。
3. Web bugfix：`D:\temp\Codex\AgentFI` 修复一个真实 bug，并输出 diff + 验证。

### 5.1 DeepSeek 真实复测记录

Provider 诊断：

```text
ic provider test --json
```

结果：

- 沙箱内网络不可达，提示网络连接失败。
- 外部网络权限下 DeepSeek 真实连通通过。
- Provider：DeepSeek。
- 模型：`deepseek-v4-pro`。
- Key 来源：config。

H5 主链路复测：

```text
把 Android App 的登录页需求转成 H5 网页，生成 login.html，包含手机号输入、验证码按钮、登录按钮和移动端样式
```

结果：

| 项目 | 结果 |
|---|---|
| 任务分类 | `code` |
| 交付类型 | Android/App 需求转 H5 网页 |
| 模型 | `deepseek-v4-flash` |
| 主链路 | 成功 |
| 证据数量 | 2 |
| Golden Path 阶段 | `patch_ready` |
| Code Delivery | `patch-ready` |
| 生成变更 | `login.html` |

补漏：

- 首次复测发现 `Code Delivery Pipeline` 未把“转成 H5 网页”识别为代码交付意图，导致 `codeDelivery=none`。
- 已将 `转成 / 转换 / H5 / 网页 / HTML / migrate / convert` 纳入代码交付意图。
- 已给 `ProviderGateway` 增加超时保护，真实模型卡住时主链路会失败返回，不再无限等待。

复测通过后，才能把体验分从当前约 35-45 分上调到 65-75 分。

## 六、当前客观评分

| 维度 | 重构前 | 当前代码级 | 真实复测后目标 |
|---|---:|---:|---:|
| 工具执行可视化 | 45 | 65 | 80 |
| 代码交付体验 | 35 | 60 | 80 |
| 失败恢复体验 | 30 | 55 | 75 |
| 长期记忆体验 | 50 | 62 | 80 |
| Provider 稳定性 | 35 | 65 | 82 |
| 产品一致性 | 40 | 68 | 82 |

结论：代码层面已经从散装工具推进到统一主循环，但还不能宣布“完成替代 Claude Code”。必须继续用真实样板任务验收。
