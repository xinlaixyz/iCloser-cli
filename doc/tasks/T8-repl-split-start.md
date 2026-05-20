# T8 — REPL 拆分开始

日期：2026-05-20  
模块：`src/cli/repl.ts`  
目标：把 REPL 单体拆成独立文件，降低继续扩展 Claude Code 替代品能力时的维护风险。  
状态：**已开始，第一刀完成**

## 一、架构师结论

T8 不应一次性大爆炸重构。当前 `repl.ts` 承载聊天、工具可视化、确认面板、系统命令、Autopilot、记忆和会话状态，任何一次大拆都会影响 REPL 主链路。

本轮采用“先抽纯展示/纯逻辑，再抽带状态模块”的顺序。

## 二、已完成第一刀

已新增独立文件：

- `src/cli/tool-display.ts`

已迁出内容：

- `TOOL_ICONS`
- `extractToolHint()`
- `extractResultPreview()`
- `createToolProgressDisplay()`
- `stripAnsi()`

`src/cli/repl.ts` 现在只在 `handleChatWithTools()` 中消费：

```typescript
onProgress: createToolProgressDisplay().handle
```

测试已从 `repl.ts` 改为直接测试 `tool-display.ts`，避免继续通过巨大 REPL 模块导入纯函数。

## 三、验证结果

```bash
npx vitest run tests/repl-tool-viz.test.ts tests/tool-loop.test.ts tests/autotest-extra.test.ts
# 3 files / 45 tests passed

npx tsc --noEmit
# passed
```

## 四、下一步拆分顺序

| 子任务 | 文件 | 内容 | 风险 |
|--------|------|------|------|
| T8-A | `src/cli/tool-display.ts` | 工具可视化已完成第一刀 | 低 |
| T8-B | `src/cli/repl-chat.ts` | 抽 `handleChatWithTools()`、普通聊天、AI 输出后处理 | 中 |
| T8-C | `src/cli/repl-panels.ts` | 抽确认面板、pendingConfirm、choice panel 渲染 | 中 |
| T8-D | `src/cli/repl-session.ts` | 抽会话保存/恢复、conversation 压缩、任务边界 | 中 |
| T8-E | `src/cli/repl-autopilot.ts` | 抽 docs/tests/repair/rollback 的 REPL 命令 | 高 |

## 五、约束

- 每次只迁出一个职责，不同时改动多个 REPL 子系统。
- 每次迁出必须保留原有 REPL smoke。
- 纯函数优先抽，状态闭包后抽。
- 不改变用户可见命令语义。
- 不污染 `--json` 输出。

## 六、验收命令

最低：

```bash
npx vitest run tests/repl-tool-viz.test.ts tests/tool-loop.test.ts
npx tsc --noEmit
npm run lint
```

阶段完成：

```bash
npm run smoke:repl
npm run smoke:repl:e2e
```
