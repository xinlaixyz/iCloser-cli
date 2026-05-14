# S17.4-S17.6: AI 上下文能力注入

日期：2026-05-14
负责人：dev3
状态：✅ 全部完成

## 背景

`context.ts` 的 `assembleContext()` 早已生成了 `externalKnowledge`（S17.5 web 搜索结果）和 `astHints`（S17.6 AST 调用图），但三个 AI Provider 适配器在构建 prompt 时都**没有注入**这些字段。同时全局记忆（用户偏好、技术栈模式）也从未加载。

## S17.4: 记忆注入 AI 上下文

### 改动

`src/core/context.ts`:
- `assembleContext()` 新增 `loadGlobalMemory()` 调用
- 新增 `assembleGlobalMemoryHints()` 函数，提取并格式化：
  - **用户代码风格偏好**：命名规范、缩进、引号、分号
  - **用户技术偏好**：偏好的库/框架
  - **注释语言偏好**：中文/英文
  - **技术栈最佳实践**：匹配当前项目语言/框架的 bestPractices + commonPatterns
  - **已知踩坑记录**：匹配当前技术栈的 pitfalls（含解决方案）
- 全局记忆片段追加到 `relevantMemory` 尾部

### 数据流

```
loadGlobalMemory() → GlobalMemory
  ├── preferences.codeStyle → "用户代码风格偏好"
  ├── preferences.techPreferences → "用户技术偏好"
  ├── techStacks[lang] → "最佳实践 + 常用模式"
  └── pitfalls[lang] → "已知踩坑记录"
  → assembleGlobalMemoryHints() → relevantMemory → AI prompt
```

## S17.5: Web 搜索入 AI 上下文

### 改动

`src/ai/provider.ts` — 三个适配器的 prompt 构建均新增 `externalKnowledge` 注入：

**Claude adapter:**
```
${projectMeta}\n${relevantCode}\n${relevantMemory}
+ \n## 网络搜索结果\n${externalKnowledge}  ← 新增
+ \n## 代码调用关系\n${astHints}            ← 新增
\n任务：${task}
```

**DeepSeek adapter:**
```
${task}\n上下文：\n${relevantCode}
+ \n## 项目记忆\n${relevantMemory}          ← 新增
+ \n## 网络搜索结果\n${externalKnowledge}    ← 新增
+ \n## 代码调用关系\n${astHints}              ← 新增
```

**OpenAI/Qwen adapter:**
```
${task}\n上下文：\n${projectMeta}
+ \n## 项目记忆\n${relevantMemory}          ← 新增
+ \n## 网络搜索结果\n${externalKnowledge}    ← 新增
+ \n## 代码调用关系\n${astHints}              ← 新增
```

## S17.6: AST 分析结果入 AI 上下文

### 改动

同 S17.5，三个 Provider 适配器均注入 `astHints` 字段。

`context.ts` 中 `assembleContext()` 的生成逻辑（已有，未改动）：
- 从任务描述提取符号名
- 匹配 `index.callGraph` 中的 `CrossFileCallEdge`
- 格式化为 "谁调用了谁 (文件:行号)" 文本

## 验收

```bash
npm run build    # ✅ tsc 零错误
npm test         # ✅ 354/354 passed, 0 skipped
npm run smoke    # ✅ release smoke 全链通过
```
