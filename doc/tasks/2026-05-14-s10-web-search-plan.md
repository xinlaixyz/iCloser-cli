# S10 网络搜索实现方案

日期：2026-05-14
目标：把"网络搜索暂不可用"变成真正可用的能力。

## 一、定位

网络搜索不是聊天机器人插件，而是 **iCloser 五层工具之一**。遵循"AI 是大脑，本地是工具"原则：

```
用户输入任务
  ↓
收集上下文（本地文件 + 项目索引 + 记忆 + 网络搜索）
  ↓
AI 大脑分析 → 决定行动
  ↓
本地工具执行 → 验证结果
```

网络搜索在"收集上下文"阶段工作：把外部知识注入 AI 的上下文窗口，让大脑有更多信息做决策。

## 二、架构

```
src/core/web-search.ts          ← 核心模块
  ├─ searchWeb(query, options)  → 返回 SearchResult[]
  ├─ cacheResult / getCached     → 本地缓存（24h TTL）
  └─ isAvailable()               → 检测后端是否可用

src/cli/loop-panel.ts           ← UI 更新
  └─ 面板显示"网络搜索：可用"而非"(降级)"

src/cli/output.ts               ← 降级提示更新
  └─ 可用时不显示降级提示
```

### 搜索后端

| 后端 | 需要 Key | 免费额度 | 适用场景 |
|------|---------|---------|---------|
| DuckDuckGo（内置首选） | 不需要 | 无限制 | 日常搜索 |
| Brave Search API | 需要 | 2000次/月 | 高质量结果 |
| SerpAPI | 需要 | 100次/月 | Google 结果 |

**默认策略：DuckDuckGo 零配置可用 → 降级提示自动消失。**

### 缓存策略

- 相同 query + 24h 内 → 读缓存
- 项目记忆（memory.json）中的已知信息 → 不重复搜索
- 搜索结果不持久化到长期记忆（除非用户确认有价值）

## 三、实现分步

### S10.1 核心模块（dev3）

文件：`src/core/web-search.ts`
测试：`tests/web-search.test.ts`

```typescript
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: 'duckduckgo' | 'brave' | 'serpapi';
}

export interface WebSearchOptions {
  maxResults?: number;      // default 5
  language?: string;        // default 'zh-CN'
  cacheResults?: boolean;   // default true
}

export async function searchWeb(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>
export function isWebSearchAvailable(): boolean
export function getWebSearchStatus(): 'available' | 'unavailable' | 'degraded'
```

实现：
1. DuckDuckGo 用 `fetch` 调 Instant Answer API（免费，无需 key）
2. Brave 用 `fetch` + API key（付费，高质量）
3. 自动降级：DDG 不可用 → 标记 unavailable

### S10.2 上下文注入（dev3）

文件：`src/core/context.ts`

在 `assembleContextFromProject` 中：
1. 检测任务中的技术关键词（库名、错误信息、API 名称）
2. 对每个关键词调用 `searchWeb`
3. 结果注入到 `ContextPackage.externalKnowledge` 字段
4. 搜索结果作为 AI prompt 的附录部分

### S10.3 工具注册表更新（dev3）

文件：`src/core/tool-registry.ts`

- `web-search` 默认状态从 `limited` 改为 `available`（DDG 零配置）
- 如果所有后端都不可用 → `limited` + 降级提示
- `renderToolFallbackSummary` 不再默认显示"网络搜索暂不可用"

### S10.4 REPL 面板更新（dev3）

文件：`src/cli/loop-panel.ts`、`src/cli/output.ts`

- 面板中网络搜索不再显示"(降级)"
- `printToolDegradationNotice` 跳过可用的网络搜索
- 搜索过程中显示 `◉ 搜索中...` 短暂状态

### S10.5 测试 + Smoke（dev3）

- `tests/web-search.test.ts`：mock fetch，验证搜索/缓存/降级
- `scripts/web-search-smoke.mjs`：真实搜索验证
- 接入 `smoke:all`

## 四、验收标准

```bash
npm run build
npm run test -- web-search
npm run smoke:loop           # 面板不再显示"1项降级"
```

必须满足：
- 启动 REPL 时不再显示"网络搜索暂不可用"的降级提示
- 技术类任务自动获取相关文档片段
- DuckDuckGo 不可用时自动降级，不阻断任务
- 搜索结果有本地缓存，相同 query 不重复请求

## 五、不做的

- ❌ 不做通用聊天式搜索（不是搜索引擎）
- ❌ 不做网页爬取和全文索引（太重）
- ❌ 不做搜索结果持久化记忆（隐私 + 噪音）
- ❌ 不做 Brave/SerpAPI 的 billing 管理（那是用户的事）
