# AgentCode 整体验收与重新分析

日期：2026-05-21  
定位：**本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统**  
依据：PRD、代码能力架构师验收、全量测试、工具/记忆/代码能力现状、macOS 验收标准。

## 一、总验收结论

**结论：阶段性通过，已具备“本地工程执行器 + Claude Code / Codex 受限场景替代品”的产品骨架；真实 Provider、复杂 Web 项目、Android 项目的长链路证据已补齐第一批，成熟发布仍需要真实 macOS 机器记录和更多长任务样本。**

当前项目已经具备一套可运行的本地 AI coding agent 骨架：能扫描项目、组装上下文、调用工具、读写代码、运行验证、生成报告、回滚、接入长期记忆，并支持 Claude / OpenAI / DeepSeek / Qwen / Mock Provider。工程能力不是纸面设计，已经有全量测试支撑。

但成熟替代品还缺 4 个关键证明：

1. macOS 发布级顺畅度：已有 `macos:acceptance` 与 CI 入口，仍需真实机器留档。
2. 多真实项目长链路：已跑通 DeepSeek demo 黄金路径、AgentFI Web/后端验证、Polymarket Android 构建/测试/安装/启动；仍需扩展到更多真实仓库。
3. 过程透明：工具调用可视化已有首版，本批补齐采用记忆与 diff 解释。
4. 发布级低噪音：已建立 trust report 与 warning budget，本轮复验已达到 lint 0 warning。

## 二、验收基线

| 项目 | 结果 |
|------|------|
| TypeScript | `npx tsc --noEmit` 通过 |
| Lint | `npm run lint` 通过，`custom lint ok`，`eslint ok`，0 warnings |
| 全量测试 | `npm test` 通过，121 test files / 1738 passed / 2 skipped |
| 代码能力定向测试 | 9 files / 171 passed |
| 文档/PDF/工具补漏测试 | 4 files / 105 passed |
| 代码能力验收文档 | `doc/ARCHITECT_ACCEPTANCE_CODE_CAPABILITY_2026-05-21.md` |

本次验收发现并修复：

- `web_search` 工具入口未传 `rootPath`，项目级磁盘缓存未真正接入主链路。
- `doc-reader.ts` 重复声明 `pdfParse`，导致全量测试中两个 doc-reader 套件加载失败。
- `read_pdf` 工具残留 PDF parser warning，影响工具结果展示洁净度。
- `collab audit --json` 在无任务记录时先输出人类提示，破坏 JSON 契约。
- `impact --json` 在未扫描项目中只输出 warning，无法被自动化解析。
- `provider doctor --json` 在未初始化项目中输出文本错误；同时兼容 `provider --json doctor` 与 `provider doctor --json`。
- `ic search` 使用 `rg --type-not binary`，当前 ripgrep 不支持该 type，导致搜索在 Windows 验收中静默失败。

修复后全量测试已通过。

## 二点五、A/B 侧任务复验

| 任务 | 验收结论 | 说明 |
|------|----------|------|
| M3 approve → AGENTS.md 写回 | 通过 | `memory-experience.ts` 与 `memory.ts` 已覆盖 approve/reject、`ic mem edit add/delete`、force sync；`tests/memory-experience.test.ts` 通过 |
| TC-03 `ic impact` | 补漏后通过 | 命令存在并输出依赖/调用/测试命中；补齐未扫描项目下的纯 JSON error envelope |
| TC-04 `ic collab audit` | 补漏后通过 | 命令存在；补齐无任务记录下 `--json` 零噪音 |
| TC-05 `ic collab review` | 通过 | `diff + verify + impact + prDraft` 三合一 JSON/文本输出可用 |
| RT-01 providerReady/key mismatch | 通过 | `setup/provider doctor` 能区分 missing/env/config/mock，并提示 key/provider 不匹配场景 |
| RT-08 JSON 零噪音 | 补漏后通过 | 对 `audit/impact/provider` 的边界噪音已修复；全量 JSON 契约测试通过 |
| RT-02 warning 清零 | 通过 | `npm run lint` 输出 `eslint ok`，不再显示 warning 数 |
| G1 真实 Provider 黄金路径 | 通过 | `scripts/golden-path-real.mjs` 已改为真实 Provider 生成计划和代码变更；DeepSeek v4-pro 跑通 8 项产物，`node --test` 8 passed |
| ADV-02 多场景案例 | 部分通过 | 两个场景产物存在，但仍属于 scripted/smoke 级证据，不能替代真实 Provider 多场景交付 |

## 二点六、T1-T4 工具编排器验收

| 任务 | 验收结论 | 说明 |
|------|----------|------|
| T1 Tool Orchestrator 核心循环 | 通过 | 新增 `src/core/tool-orchestrator.ts`，形成 `plan -> execute -> observe -> recover -> evidence` 闭环 |
| T2 任务类型模板 | 通过 | 覆盖 launch、bugfix、feature、explain、release、memory、general |
| T3 Observe/Recover | 通过 | 可分类 wrong-shell、command-not-found、missing-env、missing-sdk、test/build failed、permission/network/timeout 等失败 |
| T4 工具结果进入工作记忆 | 通过 | 新增 `src/core/execution-memory.ts`，记录 facts、failures、verified、decisions |
| Android 启动闭环 | 通过 | 已从 Polymarket 实战沉淀为 `assembleDebug -> wait boot_completed/PackageManager -> adb install -r -> resolve-activity/am start -> AVD/ADB 诊断` |

验收命令已通过：

```bash
npx tsc --noEmit
npm run lint
npm run build
npx vitest run tests/tool-orchestrator.test.ts
npm test
node dist/index.js orchestrate "启动项目" --json
node dist/index.js orchestrate "启动项目" --execute --max-steps 6 --json   # Polymarket Android 实测通过
node dist/index.js orchestrate "发布检查" --json
node dist/index.js orchestrate "解释 diff 风险"
```

结论：工具能力从“可调用工具”推进到“能围绕任务编排工具并保留证据”。默认 dry-run 保证安全；真实启动、安装、构建等动作需要显式 `--execute`。

## 三、重新评分

综合评分：**8.1 / 10**

| 能力 | 评分 | 验收判断 |
|------|------|----------|
| 本地工程执行能力 | 8.5 | 扫描、工具、命令、验证、回滚、审计均有基础闭环 |
| Claude Code 级代码能力 | 9.1 | 生成、修复、AI 测试、结构化 code review、diff explain、DeepSeek 真实 Provider 黄金路径已具备；AgentFI 与 Polymarket 真实项目验收已补第一批样本 |
| 长期记忆能力 | 9.2 | Memory Kernel 强，AGENTS/CLAUDE 文件互操作、执行前记忆展示、edit/why/used 已补；冲满分还需冲突检测和自动合并 |
| 工具能力 | 8.4 | 12 类工具能力较完整，权限/过程展示仍要产品化 |
| 测试能力 | 8.8 | 全量 1738 passed，质量门禁可信；warning 和 CI 分层需继续优化 |
| macOS 顺畅度 | 8.0 | 已有跨平台设计、CI macOS smoke、`macos:acceptance` 验收入口；仍需补真实机器记录 |
| 架构可维护性 | 7.3 | 分层清晰，`index.ts` / `repl.ts` 仍是主要风险 |
| 产品可用性 | 8.0 | CLI 可演示，协作与发布门禁入口已补，记忆与 diff 透明度已提升；真实交付案例和长任务体验仍需加强 |
| 安全与可控性 | 7.9 | 路径、命令、提交、回滚已有基础；沙箱审批还需产品化 |

## 四、体验评分

按当前定位，体验不能只按“命令能不能跑”打分，而要按用户把它当作 Claude Code / Codex 替代品时的完整感受打分：启动是否顺、任务过程是否透明、改代码是否可信、失败时是否能理解和恢复、记忆是否真的帮上忙。

总体体验分：**8.5 / 10**

| 体验维度 | 分数 | 判断 |
|----------|------|------|
| 首次启动与安装 | 7.3 | mock provider、setup、doctor、JSON 输出已有基础；macOS 安装和非 git 目录体验仍需实测降噪 |
| 项目理解体验 | 8.0 | scan、overview、context、AST hints、记忆注入较完整，能给用户“它读懂项目”的感觉 |
| 代码交付体验 | 8.9 | 生成、修复、验证、回滚链路具备，DeepSeek 真实 Provider 黄金路径已通过；AgentFI 与 Polymarket 真实验收补强了长链路可信度 |
| 工具执行可视化 | 7.0 | 首版工具进度已接入 REPL，但真实终端、多工具长任务、macOS/iTerm2 观感还没验收 |
| 长期记忆体验 | 9.2 | `ic mem edit/used/why` 与 `ic t` 执行前采用记忆展示已补齐；任务后候选已有 review/approve/reject，冲满分需自动合并写回与冲突检测 |
| 安全与掌控感 | 7.6 | 危险命令、路径、commit、rollback 基础不错；权限审批还偏工程化，不够产品化 |
| 失败恢复体验 | 7.4 | verify loop、rollback、report 已有；本轮能从 Android 模板测试、Robolectric SDK、损坏 AVD 连续恢复到前台启动，但错误提示仍需产品化 |
| macOS 开发者体验 | 8.0 | `smoke.yml` 已覆盖 macOS build/smoke/tools，新增 `npm run macos:acceptance` 和 macOS CI 轻量开发者路径；仍需真实机器日志 |
| 团队协作体验 | 8.1 | `ic collab issue/pr/commit` 与快捷命令已补；`ic pr` 可自动附加最近任务报告/验证日志并支持 `--task` |
| 发布信任感 | 8.2 | `release:trust` / `release:trust:full` 已生成 trust report，并执行 warning budget；当前 `npm run lint` 为 0 warning |

体验结论：

- 对内部工程师：**8.8/10**，已经能作为本地工程 agent 原型使用。
- 对种子用户：**8.4/10**，可试用，但必须明确“候选替代品”定位。
- 对外宣称成熟 Claude Code / Codex 替代品：**8.6/10**，还不够，核心缺真实 macOS 机器记录和更多长任务样本。

本次提升项：

- macOS：新增 `scripts/macos-acceptance.mjs`、`npm run macos:acceptance`，并在 `macos-latest` CI smoke 中加入轻量开发者路径。
- 团队协作：新增 `src/commands/collaboration.ts`，提供 issue 计划、PR 草稿、commit 草稿；所有命令默认不推送、不提交、不调用外部 API。
- 记忆体验：新增 `src/core/memory-experience.ts`、`ic mem edit`、`ic mem used`、`ic mem why`，并在 `ic t` 中展示本次采用记忆。
- Claude Code 对标：新增 `ic diff explain` / `ic explain-diff` 与 `npm run smoke:golden`，补齐本地黄金路径和 diff 解释。
- 团队协作：新增 `src/commands/collaboration.ts`，提供 issue 计划、PR 草稿、commit 草稿；PR 草稿自动附加任务报告/验证日志；所有命令默认不推送、不提交、不调用外部 API。
- 发布信任：新增 `scripts/release-trust-check.mjs`、`npm run release:trust`、`npm run release:trust:full`，并让 `prepublishOnly` 使用完整信任门禁；信任门禁会落地 `doc/release/TRUST_REPORT_YYYY-MM-DD.md`。
- Git 状态解析：修复 porcelain 文件名解析，避免 `README.md` 被截成 `EADME.md`，保证 PR/commit 草稿可信。

提升体验分最快的 5 个动作：

1. 扩展真实 Provider 黄金路径到 Android/Web/后端各 1 个项目，留下完整 diff、verify、repair、report 记录。
2. 在 REPL/CLI 中稳定展示工具调用、采用记忆、验证阶段和失败修复过程。
3. 在 macOS 真实环境跑通安装、首次使用、工具 smoke、记忆导入导出。
4. 增加 `ic mem edit` 和“本次采用记忆”展示。
5. 清理 lint warnings 与非预期 stderr，让用户看到的是可行动提示，不是底层噪音。

## 五、按定位重新分析

### 1. 本地工程执行器

已可验收：

- `scan` / `overview` 可建立项目画像。
- `run_command` 有危险命令拦截、Windows 适配、dry-run。
- `runVerification()` 已覆盖 compile / lint / unit-test / coverage 等阶段。
- `gate`、`rollback`、`audit`、`doctor` 已形成工程安全底座。
- `createCommit` 安全策略已独立成 `src/core/commit-security.ts`。

不足：

- 验证管线 T9 并行化尚未落地。
- 长任务状态和失败恢复还不够产品化。
- CLI 主入口仍偏重，后续扩展会继续推高维护成本。

判断：**本地工程执行器达到可继续开发与内部试用标准。**

### 2. Claude Code / Codex 替代品

已可验收：

- 支持项目上下文、代码生成、代码修复、结构化审查、测试生成、验证修复循环。
- 工具层可读文件、搜代码、跑命令、查网页、读 PDF/DOCX/XLSX、看 git 状态。
- REPL 工具执行可视化已有首版，`tool-display.ts` 已从 REPL 中拆出。
- 支持多 Provider 与离线 mock。

不足：

- 已有 DeepSeek 在 demo 项目上完成完整任务的黄金路径记录；已补 AgentFI 与 Polymarket 第一批真实项目验收，仍缺更多长任务样本。
- PR/Issue/commit 团队协作闭环不足。
- 工具调用和 diff/verify/repair 的体验还不如成熟 Claude Code 顺。

判断：**已经是替代品候选，不是成熟替代品。下一步必须用更多长任务、macOS 实机和发布包证明稳定性。**

### 3. 长期记忆系统

已可验收：

- Memory Kernel 已有 Sensory / Working / Episodic / Semantic 分层。
- 支持 `AGENTS.md`、`CLAUDE.md`、Copilot/Cursor 规则导入。
- 支持 `ic mem recall`、`ic mem import`、`ic mem export`、`ic mem manifests`。
- Node 18/20 有 JSONL/rules 降级路径，Node 24+ 可启用 SQLite 增强。
- 中文任务到英文代码/记忆匹配已修复过关键断裂。

不足：

- 记忆冲突检测和自动合并还需要更强。
- 任务后候选规则虽然已有 review/approve/reject/write-back，但仍需要更自然地融入长任务总结。
- 真实项目中的记忆采纳证据还需要继续积累。

判断：**记忆能力是差异化优势，已经从内核能力推进到可用体验；冲满分需要冲突主动提示和自动合并。**

## 六、关键风险清单

| 优先级 | 风险 | 影响 | 处理建议 |
|--------|------|------|----------|
| P1 | 多真实项目黄金路径仍偏少 | 第一批样本已通过，但还不足以覆盖复杂真实场景 | 继续补前端、后端、Android、CLI、库项目各 1 条长任务 |
| P1 | macOS 缺真实机器记录 | CI 和脚本已补，但真实开发者机器仍需留档 | 真实 macOS 跑 `npm run macos:acceptance` |
| P0 | 工具/记忆过程透明度不足 | 用户不清楚 agent 在做什么，信任感不足 | REPL/CLI 展示工具调用、采用记忆、验证阶段 |
| P1 | 发布信任仍缺真实发布包校验 | 对外发版前还缺安装包/校验和留档 | 跑 `release:trust:full` 并补发布包校验记录 |
| P1 | T9 验证并行化未实现 | 长任务反馈慢 | 先并行 compile/lint，coverage/e2e 保持串行 |
| P1 | `index.ts` / `repl.ts` 偏重 | 后续迭代风险变高 | 继续按 T8 拆分 |
| P2 | GitHub API 尚未接入 | 当前只有本地草稿流 | 后续接 `gh`/GitHub API，保留本地草稿作为无网兜底 |

## 七、下一步行动

### Day 1-2：真实黄金路径

目标：把已经跑通的 DeepSeek/AgentFI/Polymarket 第一批样本扩展为可持续回归的黄金路径库。

验收链路：

```text
setup -> scan -> mem import -> task -> plan -> code change -> diff -> verify -> repair -> report -> rollback/commit
```

产物：

- 输入需求。
- 采用的项目记忆。
- AI 计划。
- 修改 diff。
- 验证日志。
- 失败修复记录。
- 最终报告。
- 回滚或提交记录。

### Day 2-3：macOS 顺畅度

最低命令：

```bash
npm ci
npm run build
npx tsc --noEmit
npm run lint
npm test
npm run smoke
npm run smoke:tools
```

用户路径：

```bash
ic --help
ic setup --mock --json
ic init
ic scan --json
ic doctor --json
ic provider list --json
ic mem status
ic mem manifests
ic t "读取项目并给出修改计划" --dry-run
```

### Day 3-5：透明体验与信任感

- REPL 展示工具调用过程：工具名、目标、耗时、结果摘要。
- `ic t` 开始前展示采用的记忆摘要。
- 清理非预期 stderr、warning 和 debug 日志。
- JSON 输出继续保持无 spinner、无彩色、无 warning。

### Week 2：团队协作闭环

- `ic commit`：结合 diff、验证结果生成提交说明。
- `ic pr create`：本地生成分支、提交、PR 描述。
- `ic issue plan`：从 issue 文本生成任务计划。
- 后续再接 GitHub API。

## 八、放行判断

| 场景 | 判断 |
|------|------|
| 内部继续开发 | 通过 |
| 给工程师继续补任务 | 通过 |
| 对外宣称 Claude Code / Codex 成熟替代品 | 不通过 |
| 对外宣称“本地 AI coding agent 原型/候选替代品” | 可谨慎通过 |
| 发布给种子用户试用 | 有条件通过：必须先补真实黄金路径和 macOS 验收 |

最终判断：

> AgentCode 已经过了“能不能做”的门槛，下一阶段要证明“能不能稳定交付真实项目”。真正的分水岭不是再堆功能，而是用真实 Provider、真实仓库、真实验证日志，把 Claude Code 级闭环跑出来。
