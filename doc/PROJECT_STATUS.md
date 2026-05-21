# iCloser Agent Shell — 项目状态总览

生成日期：2026-05-21 (程序员B FIX-03~06 完成后)
状态：✅ 119 测试文件 / 1723 passed / 2 skipped。`tsc --noEmit` 零错误。`npm run lint` **0 errors / 0 warnings**（FIX-05 完成）。CI 已重构为三级流水线，macOS 跑完整序列。降级消息模块已落地。

## 本批次更新 (2026-05-21 第二批)

### 程序员B 基础修复 FIX-03 ~ FIX-06

#### FIX-05 — lint P0 规则修复：108 warnings → 0

- **`eslint.config.mjs`**：补齐 `varsIgnorePattern: '^_'`、`caughtErrorsIgnorePattern: '^_'`、`destructuredArrayIgnorePattern: '^_'`，与已有 `argsIgnorePattern` 对齐，使 `_` 前缀约定在全部场景下生效。
- **31 个源文件**（`ast-parser.ts` / `repl.ts` / `index.ts` / `scanner.ts` / `context.ts` 等）：
  - 删除/移除未使用 import：`processStep`、`EpisodeType`、`BottomPanelState`、`StreamCallback`、`getWebSearchStatus`、`formatGateSummary`、`serializeTask/List`、`MemoryCandidate`、`ProjectMemory`；
  - 前缀未使用参数与局部变量（`_source`、`_identity`、`_lang` 等 40+ 处）；
  - 删除 `context.ts` 中 9 行无引用的 `CONTEXT_PRIORITY` 常量块；
  - 修复 `config.ts:100` 和 `context.ts:88` 的 `/* global ... */` 误触发 ESLint 全局声明问题，改为 `/* project config is corrupt — skip */` / `/* loading global-memory is optional */`。
- 验收：`npx eslint "src/**/*.ts"` 输出 **0 problems**（前一轮 108 warnings）。

#### FIX-03 + FIX-04 — CI 三级流水线 + macOS 完整序列

**`.github/workflows/ci.yml`** 与 **`.github/workflows/smoke.yml`** 同步重构：

| 层级 | Job | 触发条件 | 目标耗时 | 内容 |
|------|-----|---------|---------|------|
| Tier 1 | `quick` | 所有推送/PR | <10 s | tsc + lint + release:trust |
| Tier 2 | `acceptance` | quick 通过后 | <30 s | unit tests，Node 18/20/22 矩阵 |
| Tier 3 | `smoke` / `docker` / `ai-capability` | acceptance 通过后 | <120 s | 多 OS smoke + Docker + AI smoke |

- **FIX-03 macOS 完整序列**：`smoke` job 内 macOS 节点新增条件步骤 `if: matrix.os == 'macos-latest'`，在 build 后依次执行 `tsc → lint → test`，再跑 `smoke → macos:acceptance`。旧流程仅 `build → smoke`，跳过了 tsc/lint/test。
- `docker` 和 `ai-capability` 解锁时机从 `test` 提前到 `acceptance`，整体 pipeline 延迟降低约 1 个 job 层。

#### FIX-06 — 降级消息标准化模块

新增 **`src/core/degradation.ts`**（147 行）：

```
DegradeTier: minor（⚡）| moderate（⚠️）| severe（🔴）
```

8 个预设场景函数：`providerUnavailable` / `networkFailure` / `fileSystemDegradation` / `toolUnavailable` / `memoryDegradation` / `gitUnavailable` / `aiOutputError` / `buildFailure`。

每条消息包含：标题（中文）、原因（cause）、建议操作（action），通过 `formatDegrade()` 渲染为统一多行格式或 `formatDegradeCompact()` 单行格式。

接入 `src/index.ts` 三处现有降级点：
- Provider smoke 失败 → `providerUnavailable(smoke.error)`
- 网络搜索失败 → `networkFailure(err.message)`
- ripgrep 不可用 → `toolUnavailable('ripgrep', ...)`

### 当前门禁基线（2026-05-21 第二批后）

```
npx tsc --noEmit       # 通过（0 errors）
npm test               # 119 files / 1723 passed / 2 skipped
npm run lint           # 0 errors / 0 warnings  ← FIX-05 完成
npm run smoke          # 通过
npm run release:trust  # 通过（warning budget: 0/20）
```

## 本批次更新 (2026-05-21)

### 阶段: 代码能力提升架构师验收
- 验收结论：工程师提交的代码能力提升在补漏后通过，不能按原文档写成“零回归”；首次全量测试暴露 `src/core/doc-reader.ts` 的 `pdfParse` 重复声明，已修复。
- 工具链路补齐：`executeToolCall('web_search')` 现在把 `rootPath` 传给 `searchWeb()`，项目级 `.icloser/web-cache.json` 磁盘缓存正式接入 AI 工具执行主路径。
- 回归测试：新增 `tests/tool-executor-web-search-root.test.ts`，明确锁定 `web_search` 的 rootPath 传递行为。
- 输出洁净度：`read_pdf` 工具增加 PDF parser warning 抑制，避免工具结果展示时混入 `Indexing all PDF objects` 噪音。
- 文档验收：新增 `doc/ARCHITECT_ACCEPTANCE_CODE_CAPABILITY_2026-05-21.md`，记录验收命令、补漏项、能力判断和剩余行动。
- 整体验收：新增 `doc/OVERALL_ACCEPTANCE_REANALYSIS_2026-05-21.md`，按“本地工程执行器 + Claude Code/Codex 替代品 + 长期记忆系统”重新验收，综合评分 8.1/10，体验评分提升到 7.8/10；其中 macOS 开发者体验、团队协作体验、发布信任感均提升到 8.0/10。
- 体验补强：新增 `ic collab issue/pr/commit`、快捷 `ic issue` / `ic pr` / `ic commit-draft`，提供本地 issue 计划、PR 草稿和提交草稿，不自动提交、不推送、不调用外部 API。
- 记忆体验：新增 `src/core/memory-experience.ts`、`ic mem edit list/add/delete`、`ic mem used`、`ic mem why`，并在 `ic t` 创建任务后展示“本次采用记忆”（规则数/偏好数/相关历史/候选数/冲突提示），长期记忆体验从内核能力推进到用户可感知闭环。
- Claude Code 对标：新增 `ic diff explain` / `ic explain-diff`，可解释当前 diff 的每文件意图、风险和建议验证；新增 `npm run smoke:golden` 覆盖 setup/init/memory/diff/pr/commit-draft 本地黄金路径。
- 团队协作增强：`ic pr` / `ic collab pr` 默认读取最近 `.icloser/tasks/<id>/report.md` 与 `verify.log`，支持 `--task <id>` 附加指定任务证据。
- 发布门禁：新增 `npm run macos:acceptance`、`npm run release:trust`、`npm run release:trust:full` 与 `ic release report`；`prepublishOnly` 改为完整信任门禁；`release:trust` 默认 warning budget 为 20，会生成 `doc/release/TRUST_REPORT_YYYY-MM-DD.md` 并执行预算检查。
- 当前验证：`npx tsc --noEmit` 通过；`npm run build` 通过；`npm run lint` 通过（9 warnings）；`npm run smoke:golden` 通过；`npm run release:trust` 通过；`npm test` 通过（119 files / 1723 passed / 2 skipped）。
- Polymarket 启动链路补漏：针对 `D:\temp\Codex\Polymarket` 复盘发现，REPL 在真实 Provider 工具循环后只完成文件分析，没有继续执行启动闭环；同时 Gradle 检测会把 Android 项目误判成普通 Java `bootRun`。已修复为：AI 工具分析若未调用 `run_command`，继续进入本地启动闭环；Android Gradle 项目识别为 `Android installDebug + launch`，读取 `local.properties` 的 `sdk.dir`，尝试 ADB/Emulator、`installDebug` 和 `monkey` 启动应用。补漏点包括 Windows PowerShell 启动时禁用 `shell: true`，避免 `$adb/$emu` 变量被宿主 shell 破坏；模拟器选择优先 `test_avd`；等待条件从 boot prop 改为 ADB `device` 在线态，`offline` 不再误判成功。
- Polymarket 真实验收：`node D:\temp\Codex\AgentCode\dist\index.js start` 在 `D:\temp\Codex\Polymarket` 已完成 `:app:installDebug`，输出 `Installed on 1 device` 与 `BUILD SUCCESSFUL`；`adb devices -l` 显示 `emulator-5554 device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64`；`dumpsys activity activities` 显示 `topResumedActivity=com.aistudio.web3predict.pwqxyz/com.example.MainActivity`；APK 产物为 `app/build/outputs/apk/debug/app-debug.apk`，大小 11,986,860 bytes。遗留提醒：Polymarket `.env` 中 `GEMINI_API_KEY=PLACEHOLDER_API_KEY`，如果应用运行时依赖 Gemini API，需要替换为有效 key 后重新构建。

## 本批次更新 (2026-05-20)

### 阶段: PRD 对齐与质量门禁修复
- 跨平台测试：`report-agent.test.ts` 从硬编码 `/tmp/test-project` 改为 `os.tmpdir()` + `mkdtemp()`，避免 Windows 权限/路径问题。
- Memory Kernel：修复 `store.ts` 在 TS/Vitest ESM 路径下 `require('./sqlite-store.js')` 找不到模块的问题；`sqlite-store.ts` 延迟加载 `node:sqlite`，并在 SQLite 不可用时降级为 JSONL 情景日志 + `rules.json/tree.md` 语义记忆，保持 Node >=18 产品承诺。
- Memory 生命周期：`resetMemoryRuntime()` 改为可等待 shutdown，`context.test.ts` 清理临时目录前显式释放 SQLite 句柄，修复 Windows `EBUSY`。
- Vitest 配置：关闭 Vitest cache，避免写入 `node_modules/.vite/vitest/results.json` 触发权限问题；`deps.external` 迁移到 `server.deps.external`。
- 测试性能：`cli-full-coverage.test.ts` 复用共享 fixture，覆盖率型 spawn 测试不再重复 `init + scan` 或跑完整 `t --go` 执行链；完整 `npm test` 本机实测 68.59s。
- 输出洁净度：测试脚本通过 `node --no-warnings` 和 `NODE_OPTIONS=--no-warnings` 屏蔽 Node `node:sqlite` experimental warning；跨平台命令测试准备真实文件，消除 `FINDSTR` 噪音。
- 验收口径：`scan` acceptance 不再依赖 stdout 非空，改为验证命令成功且生成 `.icloser/index.json`，更贴近 PRD 的“项目扫描与索引”产品目标。
- Lint 噪音：低风险清理测试与 Memory 模块未使用 import/变量，warnings 从 139 降至 120。
- 用户/市场验收：补充真实 CLI 用户路径验收与市场需求评估；发现并修复 coverage 阶段绕过项目脚本导致全量测试超时的问题。
- 覆盖率门禁：`runCoverageStage()` 现在复用项目 `coverage/test:coverage` 脚本和调用方 timeout，不再在临时项目里强行 fallback 到 `npx c8 vitest`。
- Codex / Claude Code 对标：新增 Agent 记忆文件能力，支持导入 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`、`.cursor/rules` 到 Semantic Memory，并支持导出项目规则到 `AGENTS.md`。
- 全局路径隔离：`saveGlobalConfig()` / `loadGlobalConfig()` 和旧全局 Memory 均改为运行时读取 `ICLOSER_HOME`，避免测试或便携安装误写真实用户目录；全局记忆在 `EPERM/EACCES` 时降级为不阻塞任务。
- 代码生成安全：`generateWithVerifyLoop()` 写入 AI 生成文件前限制路径必须位于项目根目录内，并对写入失败给出诊断而不是崩溃。
- 测试质量门禁：`detectEmptyTests()` 现在可识别 `it/test("x", () => {})`、`async () => {}` 和常见错误写法，降低空测试被误收的风险。
- 架构重构验收：`Provider` 已抽出 `OpenAICompatibleProvider`，`task/memory` 命令已迁出 `index.ts`；代码生成路径统一通过 `parseAIOutput()` 协议解析。
- 集成补漏：`ic t` 主链路已从同步 `generatePlan()` 改为 `generatePlanAsync()`，实际用户创建任务时会优先使用 AI 语义拆解，AI 不可用或返回异常时自动降级到关键词分解。
- 关键能力评分：更新 `doc/CAPABILITY_ASSESSMENT.md`，按 AI 记忆、工具、代码、测试、架构、产品可用性重新评分，综合为 7.8/10。
- 工具能力排期：新增 `doc/ARCHITECT_ACCEPTANCE_DEV2_TOOL_PLAN_2026-05-20.md`，明确程序员2补齐 DOCX/XLSX 工具、工具过程可视化、工具权限产品化和 smoke 验收脚本。
- 产品定位澄清：PRD 与验收文档已明确 AgentCode 是“本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统”，后续代码能力必须按 Claude Code 级闭环验收，Memory Kernel 必须承担跨会话长期项目记忆。
- 整体重分析：新增 `doc/OVERALL_REANALYSIS_2026-05-20.md`，按三层定位重新评估项目，综合评分更新为 8.0/10。

### 用户/市场验收发现 (2026-05-20)
- 真实 CLI 路径通过：`--help`、`setup --mock --json`、`init`、`scan --json`、`doctor --json`、`provider list --json`、`mem status`、`plan create` 均可完成。
- `init` 在非 git 项目里已按验收要求降级为安静检测，不应再向用户输出 `fatal: not a git repository`。
- Memory mock 初始化错误已从用户/测试输出中清理；类似降级信息只允许 debug 或明确中文提示。
- 市场侧关键缺口：要成为 Codex/Claude Code/Copilot coding agent 替代品，仍需补齐真实 Provider 代码交付黄金路径、PR/Issue 工作流、长任务可视追踪、权限/沙箱产品化、团队级审计与真实 agent 端到端案例。
- 记忆侧新增入口：`ic mem manifests` 查看可识别记忆文件，`ic mem import [file...]` 导入项目指令，`ic mem export [file]` 生成可共享的 Agent 项目说明。
- 真实记忆 CLI 验收通过：在临时项目中创建 `AGENTS.md` / `CLAUDE.md` 后，`ic mem manifests`、`ic mem import`、`ic mem recall`、`ic mem export AGENTS.generated.md` 均可完成。

### 当前验证命令
```
npx tsc --noEmit
npm test
npm run lint
```

### 当前仍待处理
- `src/index.ts`、`src/cli/repl.ts`、`src/core/ast-parser.ts` 仍是维护风险最高的巨石文件，应随模块拆分继续清理剩余 144 个 ESLint warnings；其中 `index.ts` 已迁出 task/memory 命令，但任务执行主流程仍需继续拆分。
- PRD 中运行时 `>=18.0.0` 已通过 Memory Kernel 降级路径守住；后续文档应继续明确：SQLite 索引是 Node 24+ 增强能力，Node 18/20 使用 JSONL/rules 文件存储并保留基础 Recall。
- Acceptance 测试已覆盖 pipeline/codegen/rollback，但 spawn 型验收仍占用约 50-55s，需要后续按 CI 分层拆成 quick/unit 与 acceptance jobs。
- 程序员2工具能力进展：`read_docx` / `read_xlsx`、工具执行事件 hook、权限矩阵与 `smoke:tools` 已进入源码和发布产物验收；下一步聚焦工具过程展示接入 CLI/REPL、权限产品化与真实 Provider 黄金路径。
- T4 REPL 工具执行可视化代码级验收通过：`handleChatWithTools()` 已接入 `runToolLoop.onProgress`，工具调用显示 thinking/tool_call/tool_result/synthesizing/done；`tests/repl-tool-viz.test.ts` + `tests/tool-loop.test.ts` 共 29 tests passed。下一步做真实 REPL 和 macOS 终端观感复验。
- macOS 顺畅度已纳入正式验收标准：新增 `doc/MACOS_ACCEPTANCE_STANDARD_2026-05-20.md`，要求 macOS 真实机器或 `macos-latest` CI 跑通 build/tsc/lint/test/smoke/smoke:tools，并覆盖安装、Unix Shell、`./mvnw`/`./gradlew`、路径权限、长期记忆、JSON 纯净输出和 macOS 打包体验。
- `createCommit` 安全策略已独立成 `src/core/commit-security.ts`：提交前统一校验空消息、空文件列表、路径逃逸、真实路径逃逸和默认敏感文件；`src/utils/git.ts` 只负责执行 git。新增 `tests/commit-security.test.ts`，定向 30 tests passed。
- T8 REPL 拆分已开始：新增 `src/cli/tool-display.ts`，先从 `repl.ts` 迁出工具进度显示纯逻辑；`tests/repl-tool-viz.test.ts` 改为直接覆盖独立文件。新增 `doc/tasks/T8-repl-split-start.md`。
- T9 验证并行化已立项：Day1 安全修复已完成，新增 `doc/tasks/T9-verifier-parallelization-plan.md`；第一版建议只并行 `compile/lint`，coverage/e2e 保持串行，避免写入竞态。

---

生成日期：2026-05-16 (最终 — 5 项优化完成)
状态：✅ 471 测试 / 0 失败 / 48 文件。tsc 零错误。lint 0 errors。Acceptance 9/9。Smoke 全通过。综合评分 8.2/10。

## 本批次更新 (2026-05-16)

### 阶段: Bug 修复 (P0 — 5 项)
- context.ts:491 操作符优先级加括号（注释行过滤失效）
- repl.ts:136 对话压缩窗口 off-by-one（消息丢失）
- provider.ts:611 Claude 假流式 → 真流式 `client.messages.stream()`
- code-writer.ts:132 静默错误吞没 → 返回空结果
- provider.ts:824 OpenAI provider 缺上下文注入

### 阶段: AI 执行智能 (P1 — 4 项)
- **新模块** tool-strategy.ts: 14 意图 → 有序工具序列模板
- tool-executor.ts: 搜索/命令结果压缩函数
- tool-executor.ts: 3次空结果自适应策略切换
- tool-executor.ts: Unix→Windows 命令自动转译+执行（35+ 命令）

### 阶段: 代码生成质量 (P2 — 3 项)
- code-writer.ts: scaffold 支持 StyleFingerprint 参数
- code-writer.ts: generateWithVerifyLoop（编译+lint → 自动修复 × 3 轮）
- index.ts: 代码变更任务展示影响面 + 风险警告

### 阶段: 跨平台/启动 (P3 — 3 项)
- detect.ts: detectSubprojects（depth-2 扫描 7 种构建文件）
- detect.ts: checkDependencies（Java/Go/Python/Rust 依赖检查）
- tool-executor.ts: mvnw.cmd / gradlew.bat 自动检测

### 阶段: 测试补全 (P4 — 4 项)
- **新文件** startup.test.ts (9 测试), cross-platform.test.ts (8 测试), tool-strategy.test.ts (11 测试)
- live-acceptance.mjs: 1 场景 → 5 场景

### 阶段: 强制闸门 (Gate — 3 项)
- Gate-1: 代码输出后强制编译验证 + 2轮自动修复（code-writer.ts:enforceCodeQuality）
- Gate-2: 记忆注入前真实性校验（文件存在 + 幻觉标记检测）
- Gate-3: detectSubprojects 接入 scanProject, checkDependencies 接入 cmdStartProject

### 阶段: 收尾清理 (Task 1-8 — 2026-05-16)
- Task 1: 修复 18 个 TS 错误 → tsc --noEmit 零错误
- Task 2: 修复 agent/manager.ts 运行时 bug（this.id → orchestration task）
- Task 3: 编译闸门扩展到 ic gen new 路径
- Task 4: 配置覆盖率报告（npm run test:coverage → 43.6%）
- Task 5: 删除死代码（skill/manager.ts、style-verifier.ts、4 个未使用 memory 导出）
- Task 6: 真实验收测试增强（5 场景，live-acceptance.mjs）
- Task 7: 提取 startup.ts 模块（250 行从 repl.ts 分离）
- Task 8: 验证 AST 9 语言支持（Go/Python tree-sitter 可用，正则回退就绪）

## 快速导航

| 文档 | 内容 |
|------|------|
| `doc/CAPABILITY_ASSESSMENT.md` | **最新** 关键能力综合评分 (7.8/10)，覆盖 AI 记忆、工具、代码、测试、架构与产品可用性 |
| `doc/ARCHITECTURE.md` | 架构设计 |
| `doc/PROJECT_COMPLETION_ANALYSIS.md` | 完成度分析 |
| `doc/STARTUP_GAP_ANALYSIS.md` | 启动能力差距 (S1-S5) |
| `doc/TOOL_INTENT_GAP.md` | 工具意图差距 (TI1-TI5) |
| `doc/QUALITY_FIX_PLAN.md` | 质量修复方案 |
| `doc/INTENT_DEVIATION_ANALYSIS.md` | 需求偏离分析 |
| `docs/DEVELOPER_GUIDE.md` | 开发者指南：架构/接入/约定 |

## 架构分层

```
Human → CLI(index.ts + cli/*) → Core(core/*) → Agent(manager.ts) → AI(provider.ts) → LLM
                              ↑
                         三道强制闸门
                    (编译验证 | 记忆校验 | 依赖检查)
```

## 关键模块 (53 files)

| 模块 | 行数 | 功能 | 评分 |
|------|------|------|------|
| context.ts | 1307 | 5维相关性评分 + 3层压缩 | 9/10 |
| scanner.ts | 975 | 10阶段扫描 + 增量指纹 | 8/10 |
| memory.ts | 985 | 4层TTL记忆 + 风险分类 | 8/10 |
| provider.ts | 971 | 5 Provider 适配 | 8/10 |
| detect.ts | 759 | 14语言检测 + monorepo | 8/10 |
| code-writer.ts | 471 | 代码生成 + 编译闸门 | 7/10 |
| tool-executor.ts | 424 | 6工具 + 平台适配 | 7/10 |
| verifier.ts | 1005 | 6阶段验证 + AI修复 | 7/10 |
| task-engine.ts | 497 | DAG调度 + 文件锁 | 7/10 |
| repl.ts | 3047 | REPL + 对话状态机 | 7/10 |
| index.ts | 4412 | CLI入口 (需拆分) | 6/10 |
| ast-parser.ts | 2368 | 8语言解析 (5 tree-sitter + 3 regex) | 7/10 |

## S20-S22 UI 完成清单

```
S20.1 输出消毒        ✅  stdout 全路径
S20.2 等待动画        ✅  脉冲+计时+tokens
S20.3 状态栏          ✅  4模式单行
S20.4 Diff着色        ✅  红绿渲染
S20.5 输入框          ✅  readline原生
S20.6 错误指引        ✅  编译/lint/test
S20.7 命令面板        ✅  /? /p
S20.8 历史搜索        ✅  !query !N
S20.9 Tab补全         ✅  文件路径
S21.0 代码折叠+TLDR   ✅  >30行自动
S21.1 编排树+面板精简 ✅  单行化
S22.0 上下文仪表      ✅  实时百分比
S22.1 简洁/详细       ✅  /brief /full
```

## 测试

```
47 files / 458 tests / 444 passed / 14 failed (spawn, 因预存TS构建错误)
```

## 已知问题

### 阻塞级
- [ ] 18 个预存 TS 错误导致 `tsc` 构建失败
- [ ] `agent/manager.ts:288` — `this.id` 不存在，运行时 bug
- [ ] spawn 测试因构建失败不可用（14 个）

### 重要级
- [x] `ast-parser.ts` 已确认支持 8 语言（5 tree-sitter + 3 正则回退）
- [ ] `index.ts` 4412 行 + `repl.ts` 3047 行，单体巨石
- [ ] 死代码：`skill/manager.ts`、`style-verifier.ts`、4 个 memory 导出
- [ ] 编译闸门仅 `executeTask` 路径生效

### 后续任务（按优先级）

| # | 任务 | 验收标准 | 估时 |
|---|------|----------|------|
| 1 | 修复 18 个预存 TS 错误 | `tsc --noEmit` 零错误 | 4h |
| 2 | 修复 agent/manager.ts 运行时 bug | `this.id` 消除 | 1h |
| 3 | 编译闸门扩展到 ic gen/code | 所有代码入口有验证 | 3h |
| 4 | 配置覆盖率报告 | `npm run test:coverage` 可用 | 1h |
| 5 | 删除死代码 | 无未使用导出 | 2h |
| 6 | 真实验收测试 | 5 场景对接真实 AI | 8h |
| 7 | index.ts/repl.ts 拆分 | 每文件 < 1000 行 | 8h |
| 8 | AST 扩展到 Go/Python | 3 语言解析可用 | 12h |

## 关键模块 (49 files)

| 模块 | 行数 | 功能 |
|------|------|------|
| repl.ts | 2500+ | REPL 核心 |
| index.ts | 2900+ | CLI 入口 |
| ast-parser.ts | 1893 | 9 语言 AST |
| provider.ts | 800+ | 5 家 AI |
| memory.ts | 889 | 分层记忆 |
| scanner.ts | 820 | 项目扫描 |
| verifier.ts | 712 | 验证引擎 |
| context.ts | 790 | 上下文组装 |
| docs-generator.ts | 570+ | 文档生成+操作 |
| agent/manager.ts | 540 | Agent 管理 |

## S20-S22 UI 完成清单

```
S20.1 输出消毒        ✅  stdout 全路径
S20.2 等待动画        ✅  脉冲+计时+tokens
S20.3 状态栏          ✅  4模式单行
S20.4 Diff着色        ✅  红绿渲染
S20.5 输入框          ✅  readline原生
S20.6 错误指引        ✅  编译/lint/test
S20.7 命令面板        ✅  /? /p
S20.8 历史搜索        ✅  !query !N
S20.9 Tab补全         ✅  文件路径
S21.0 代码折叠+TLDR   ✅  >30行自动
S21.1 编排树+面板精简 ✅  单行化
S22.0 上下文仪表      ✅  实时百分比
S22.1 简洁/详细       ✅  /brief /full
```

## 测试

```
44 files / 428 tests / 0 failed / ~18s
```
