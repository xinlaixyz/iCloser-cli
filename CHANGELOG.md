# Changelog

## Unreleased — Quality Gate Alignment (2026-05-20)

### Fixed
- Cross-platform tests no longer hard-code `/tmp/test-project`; report generation tests now use `os.tmpdir()` + `mkdtemp()`.
- Memory Kernel SQLite loading now works in TS/Vitest ESM execution by removing fragile `require('./sqlite-store.js')` resolution.
- Memory Kernel now degrades gracefully when `node:sqlite` is unavailable: episodic memory remains in JSONL, semantic memory remains in rules files, and timeline queries can read JSONL fallback data.
- Memory Runtime shutdown is awaitable in tests, preventing Windows `EBUSY` cleanup failures for open SQLite files.
- Acceptance scan test now validates the product artifact `.icloser/index.json` instead of requiring non-empty stdout.
- Coverage verification now respects project `coverage` / `test:coverage` scripts and caller-provided timeouts instead of forcing fallback `npx c8 vitest`, fixing full-suite timeouts in temporary projects.
- Agent memory manifests can now be imported from `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, and `.cursor/rules`, then exported back to `AGENTS.md` for Codex/Claude-compatible project memory.
- Global config and legacy global memory now resolve `ICLOSER_HOME` at runtime, preventing tests and portable installs from writing to the real user home unexpectedly.
- Legacy global memory now degrades on permission-denied writes instead of failing the active user task.
- Code generation verification writes generated files only inside the project root and returns diagnostics on write failures.
- Empty-test detection now catches inline and async empty `it/test` blocks.

### Changed
- Vitest cache is disabled to avoid permission failures writing `node_modules/.vite/vitest/results.json`.
- Vitest dependency config moved from deprecated `deps.external` to `server.deps.external`.
- `npm test`, `test:watch`, and `test:coverage` now start Vitest through `node --no-warnings` to keep CI output clean.
- CLI coverage spawn tests now reuse one initialized fixture and avoid full `t --go` execution in coverage-only paths.
- `ic mem` help now exposes `import`, `export`, and `manifests` commands for explicit project memory files.

### Quality
- Full test suite baseline: 113 files, 1679 passed, 2 skipped, 68.59 seconds on this Windows run.
- `cli-full-coverage.test.ts` runtime reduced from about 316 seconds to roughly 38-52 seconds.
- Lint remains 0 errors; current warnings are 144 after the expanded test/document surface.
- Removed SQLite experimental warning and Windows FINDSTR stderr noise from normal test output.

## v1.0.0 — Memory Kernel (2026-05-19)

### Added
- **Memory Kernel v1.0** — 认知记忆核心 (17 个模块, ~3,500 行代码)
  - Sensory Buffer: FIFO 感官缓冲区 (5-60s TTL, 噪声过滤)
  - Working Memory: 16k-32k token 动态工作记忆
  - Episodic Memory: 情景事件日志 (JSONL+SQLite, 时间轴查询)
  - Semantic Memory: 语义规则树 (置信度+来源追溯)
  - Salience Engine: 重要度评分 (关键词+反馈+重复+衰减)
  - Forgetting Engine: M(t)=M0×e^(-t/S) 遗忘曲线
  - Consolidation Engine: 情景→摘要→语义规则自动抽象
  - Recall Engine: Timeline+Semantic+Emotion 检索+Ranking+Top-K
  - Memory Runtime: 认知调度器 (生命周期钩子)
  - Context Composer: 上下文编排 (排序+压缩+注入+防爆)
  - Bootstrap: Git 历史导入 + 代码模式提取 (自动激活)
- **CLI 命令**: `ic mem status/recall/bootstrap/consolidate/forget/inspect/rule/stats`
- **数据管道**: REPL ↔ Memory Kernel 全自动接入 (P0+P1+P2)
- **调试**: `ICLOSER_MEMORY_DEBUG=info` 环境变量
- **测试**: 63 个 Memory Kernel 单元测试 (4 文件, 0 失败)
- **文档**: MEMORY_KERNEL.md 完整产品+开发者文档

### Changed
- `src/core/memory.ts` → `src/core/memory/` (17 文件重构)
- `ic init` → 自动 bootstrap Memory Kernel
- `ic mem` → 扩展 9 个新子命令
- `task-engine.ts` → 增加 Memory Runtime 钩子
- `context.ts` → 增加 Memory Recall 注入
- `repl.ts` → P0/P1/P2 数据管道接入
- `system-runner.ts` → Shell 输出自动入感官缓冲
- `vitest.config.ts` → 配置 `node:sqlite` external

### Fixed
- integration.ts: 10 处空 catch 块 → 统一日志 + 重试机制
- runtime.ts: init/shutdown 错误隔离
- store.ts: SQLite getter 错误缓存
- semantic.ts: searchRelevant 分词匹配替代全串匹配
- sqlite-store.ts: ESM 兼容 (require→import)

### Technical
- Storage: `.agent/memory/` 目录结构 (sensory/working/episodic/semantic/archive)
- Database: Node 24+ 内置 `node:sqlite` (WAL mode, NORMAL synchronous)
- Build: TypeScript 零错误, 65 测试文件全通过 (642/644 tests)
- Memory Kernel: 54 条情景事件 + 4 条语义规则 (AgentCode 项目实测)
