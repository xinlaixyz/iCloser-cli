# Memory Kernel & Recall Runtime — 开发记录

日期: 2026-05-19 | 作者: iCloser Dev & Claude

---

## 背景

iCloser Agent Shell 在 V0.1 中已具备 Task Engine、Code Patch Engine、Verify Engine、Security Sandbox 等核心组件，但属于"无状态 AI 执行器"：每次任务都像第一次见面，没有持续记忆。

需求文档: `doc/Memory Kernel & Recall Runtime.md` (PRD v1.0)

---

## 实施过程

### Phase 1-5: 存储与记忆基础 (2026-05-19 Session 1)

创建 `src/core/memory/` 目录，实现 5 个核心存储模块：

| 模块 | 文件 | 行数 | 说明 |
|------|------|------|------|
| JSONL Store | `jsonl-store.ts` | ~90 | 追加/读取/轮转 JSONL |
| SQLite Store | `sqlite-store.ts` | ~200 | Node 24 `node:sqlite` 索引 |
| Memory Store | `store.ts` | ~135 | 工厂 + `.agent/memory/` 目录 |
| Sensory Buffer | `sensory-buffer.ts` | ~190 | FIFO 队列, TTL, 噪声过滤 |
| Working Memory | `working-memory.ts` | ~280 | 16k-32k token 分层管理 |
| Episodic Memory | `episodic.ts` | ~260 | 事件日志 + 时间轴查询 |
| Semantic Memory | `semantic.ts` | ~270 | 规则树 + 置信度 + 分词搜索 |

### Phase 6-8: 智能引擎 (2026-05-19 Session 1)

| 模块 | 文件 | 行数 | 算法 |
|------|------|------|------|
| Salience | `salience.ts` | ~180 | 关键词加权 + 反馈 + 重复 + 时间衰减 |
| Forgetting | `forgetting.ts` | ~180 | M(t)=M0×e^(-t/S) + 分级半衰期 + 保护策略 |
| Consolidation | `consolidation.ts` | ~230 | 事件分组→摘要→模式检测→规则抽象 |

### Phase 9-11: 检索与调度 (2026-05-19 Session 1)

| 模块 | 文件 | 行数 | 说明 |
|------|------|------|------|
| Recall Engine | `recall.ts` | ~340 | Task Parsing → 3 种 Recall → Ranking → Top-K |
| Memory Runtime | `runtime.ts` | ~230 | 认知调度器 + 生命周期钩子 |
| Context Composer | `composer.ts` | ~230 | Context Ranking + Compression + Injection + 防爆 |

### Phase 12-13: CLI 与集成 (2026-05-19 Session 1-2)

| 模块 | 文件 | 行数 |
|------|------|------|
| CLI Handlers | `cli-handlers.ts` | ~210 |
| Integration | `integration.ts` | ~160 |

修改: `index.ts` (+50 行 CLI 路由), `task-engine.ts` (+15 行钩子), `context.ts` (+8 行注入), `repl.ts` (+12 行接入), `system-runner.ts` (+10 行接入)

### Phase 14: 测试 (2026-05-19 Session 2)

| 测试文件 | 测试数 |
|----------|--------|
| `tests/memory/storage.test.ts` | 8 |
| `tests/memory/sensory-wm.test.ts` | 23 |
| `tests/memory/salience-forget.test.ts` | 16 |
| `tests/memory/recall-composer.test.ts` | 16 |
| **总计** | **63** |

### Phase 15-17: 缺陷修复 (2026-05-19 Session 2-3)

**P0 (严重):**
- integration.ts: 10 处空 catch → `memdbg` 日志 + 重试机制 (MAX 2)
- integration.ts: 半初始化单例 → 失败时 `_runtime = null` + 重试计数
- runtime.ts: init() 无 error isolation → try/catch + SQLite close on failure

**P1 (中等):**
- runtime.ts: shutdown() 无隔离 → 3 步各自 try/catch
- integration.ts: resetMemoryRuntime() 不释放 → 调用 shutdown()
- store.ts: getter 重复 throw → 错误缓存 `_sqliteError`
- runtime.ts: 遗忘触发器误报 → 确认代码正确 (tasksProcessed++ 在检查前)

**P2 (低):**
- semantic.ts: searchRelevant 全串匹配 → 分词匹配
- sqlite-store.ts: ESM `require('fs')` → `import { statSync } from 'fs'`
- CLI status: 输出简陋 → 人类可读分组 + 诊断 + 新手引导
- REPL: 无激活通知 → 启动提示 + `ICLOSER_MEMORY_DEBUG` 指引

### Phase 18: 完全激活 (2026-05-19 Session 3)

| 模块 | 文件 | 行数 | 说明 |
|------|------|------|------|
| Bootstrap | `bootstrap.ts` | ~270 | Git 历史导入 + 代码模式提取 + 初始固化 |
| Debug | `debug.ts` | ~50 | 统一调试日志器 |

集成: `ic init` → 自动 bootstrap, `ic mem bootstrap` → 手动引导
修复: 单例共享 (CLI handler 复用 integration 单例)

---

## 决策记录

1. **Node 24 `node:sqlite`** — 选择内置 SQLite 而非 better-sqlite3，避免 native 编译问题。代价：ExperimentalWarning，Vitest 需要 `deps.external` 配置。

2. **Lazy SQLite import** — `store.ts` 使用 `createRequire` + `require()` 懒加载，避免 Vite/Vitest build-time 解析失败。

3. **Fire-and-forget 集成** — 所有 Memory 钩子在主流程中异步执行但不阻塞。Memory 失败绝不中断 AI 对话。

4. **分词搜索** — `semantic.ts` 的 `searchRelevant` 改用分词匹配而非全串包含，因为 "iOS API" 不会作为子串出现在 "禁止在iOS项目中新增API端点" 中。

5. **git 历史作为初始数据** — Bootstrap 读取 `git log -50` 创建情景事件。每个 commit = 一个历史任务。

6. **代码配置作为初始规则** — Bootstrap 检测 tsconfig/eslint/vitest/docker 等配置文件自动生成语义规则。

---

## 技术指标

| 指标 | 数值 |
|------|------|
| 新增源文件 | 17 |
| 新增测试文件 | 4 |
| 新增代码行 | ~3,800 |
| 新增测试行 | ~1,300 |
| 修改文件 | 7 |
| 现有测试回归 | 0 |
| TypeScript 编译 | 零错误 |
| 全量测试 | 65 文件 / 642 passed / 0 failed |

---

## 验收对照 (PRD §10)

| 标准 | 状态 |
|------|------|
| Recall 成功率: 执行相关任务时正确唤醒历史规则与失败经验 | ✅ 54 条情景 + 4 条规则, Recall 分词匹配有效 |
| 上下文稳定性: Working Memory 不发生 Token 爆炸 | ✅ 预算监控 + 压缩 + Top-K 限制 |
| 语义学习: 系统能抽象出长期工程规则 | ✅ Consolidation Engine 自动固化 |
| Recall 排序: 高价值记忆优先注入 | ✅ Ranking 公式 + Salience 加权 |
| 系统稳定性: 不影响 Shell OS 任务执行 | ✅ Fire-and-forget + 所有测试通过 |

---

## 相关文档

- [Memory Kernel 完整文档](../docs/MEMORY_KERNEL.md)
- [PRD 需求文档](../docs/PRD.md)
- [架构设计](../docs/ARCHITECTURE.md)
- [开发者指南](../docs/DEVELOPER_GUIDE.md)
- [变更日志](../CHANGELOG.md)
