# 记忆与上下文 AI 能力升级方案

## 现状审计 (当前 ~30/100)

### 已有系统

| 组件 | 功能 | 问题 |
|------|------|------|
| `memory.ts` | 3层记忆(短期/任务/长期) | ⚠️ 记忆写入但从不清理过期数据 |
| `context.ts` | Token预算+分层压缩 | ⚠️ 全局记忆全量注入，无相关性过滤 |
| `context.ts:68` | 全局记忆注入(S17.4) | ⚠️ 所有记忆一股脑塞进去 |
| `context.ts:1057` | GlobalMemoryHints | ⚠️ 只有风格偏好，无任务相关记忆 |
| FIX-2 | "不要编造"提示 | ⚠️ 只是提示，AI不一定遵守 |

### 8 个断层

| # | 断层 | 现象 | 严重度 |
|---|------|------|--------|
| M1 | **无对话状态追踪** | AI不知道当前在哪个任务的第几步 | 🔴 |
| M2 | **全局记忆全量注入** | 所有历史记忆塞进context，AI注意力分散 | 🔴 |
| M3 | **无任务边界标记** | 上一轮对话和本轮混在一起 | 🔴 |
| M4 | **无对话摘要压缩** | 长对话占用大量token，旧信息不压缩 | 🟡 |
| M5 | **记忆无过期清理** | 50条旧任务记忆永远留在上下文 | 🟡 |
| M6 | **无用户意图记忆** | 用户说"用camelCase"，3轮后AI就忘了 | 🟡 |
| M7 | **无错误记忆** | AI犯过的错误不记录，下次还会再犯 | 🟢 |
| M8 | **无上下文优先级排序** | 当前任务vs历史记忆无权重区分 | 🟢 |

## 升级方案 (30 → 100)

### M1+M3: 对话状态机 + 任务边界

```
REPL会话状态:
  idle → task_created → task_running → task_completed → idle
  │                                    
  └─ conversation checkpoint: 每完成任务后压缩摘要

任务边界标记:
  state.conversation.push({
    role: 'system', 
    content: `--- 任务边界: task-xxx 完成，token: 5000, 文件: 3个 ---`
  });
```

**修改**: `repl.ts` — 新增 `conversationCheckpoint()` 函数

### M2: 全局记忆相关性过滤

```typescript
function filterRelevantMemories(
  memories: MemoryCandidate[], 
  taskDesc: string
): MemoryCandidate[] {
  const taskTokens = new Set(taskDesc.toLowerCase().split(/\s+/));
  return memories.filter(m => {
    const memTokens = new Set((m.summary + m.content).toLowerCase().split(/\s+/));
    const overlap = [...taskTokens].filter(t => memTokens.has(t)).length;
    return overlap >= 2; // 至少2个词重叠才注入
  }).slice(0, 5); // 最多5条
}
```

**修改**: `context.ts` — `assembleRelevantMemory()` 增加过滤

### M4: 对话摘要压缩

```
长对话 (>20 轮) 自动压缩:
  最近 5 轮 → 完整保留
  6-15 轮 → 摘要 (只保留关键决策/错误/产出)
  16+ 轮 → 丢弃 (或存为长期记忆)
```

**修改**: `repl.ts` — `handleChat()` 末尾自动触发压缩

### M6: 用户意图记忆

```typescript
// 自动检测并记忆用户偏好
interface UserIntentMemory {
  preference: string;     // "使用 camelCase"
  detectedAt: string;
  confidence: number;     // 0-1, 基于重复次数
}

// 写入 ProjectMemory.preferences
// 下次上下文组装时自动注入
```

**修改**: `memory.ts` — `detectAndRecordPreference()`

### M5+M7+M8: 统一上下文优先级

```typescript
// 上下文优先级系统
const CONTEXT_PRIORITY = {
  current_task: 100,      // 当前任务描述 → 必须保留
  recent_conversation: 90, // 最近5轮对话 → 优先保留
  project_code: 80,        // 相关代码 → 重要
  project_config: 70,      // 配置文件 → 重要
  task_history: 40,         // 历史任务 → 压缩后保留
  global_memory: 20,        // 全局记忆 → 仅相关时保留
  fallback: 0,
};

// Token预算分配按优先级加权
```

**修改**: `context.ts` — `assembleContext()` 增加优先级分配

---

## 实现计划

| 优先级 | 断层 | 预计效果 | 改动文件 |
|--------|------|---------|---------|
| 🔴 P0 | M1 对话状态机 | AI知道当前在哪一步 | `repl.ts` + `types.ts` |
| 🔴 P0 | M2 记忆相关性过滤 | 不再注入无关记忆 | `context.ts` |
| 🔴 P0 | M3 任务边界标记 | 对话不再混乱 | `repl.ts` |
| 🟡 P1 | M4 对话摘要压缩 | 长对话不超token | `repl.ts` |
| 🟡 P1 | M6 用户意图记忆 | 记住用户偏好 | `memory.ts` |
| 🟡 P1 | M8 上下文优先级 | token分配更合理 | `context.ts` |
| 🟢 P2 | M5 记忆过期清理 | 防止记忆膨胀 | `memory.ts` |
| 🟢 P2 | M7 错误记忆 | 不重复犯错 | `memory.ts` |
