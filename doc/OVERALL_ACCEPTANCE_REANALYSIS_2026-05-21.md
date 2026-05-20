# AgentCode 整体验收与重新分析

日期：2026-05-21  
定位：**本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统**  
依据：PRD、代码能力架构师验收、全量测试、工具/记忆/代码能力现状、macOS 验收标准。

## 一、总验收结论

**结论：阶段性通过，可以继续向“Claude Code / Codex 受限场景替代品”推进，但还不能发布为成熟替代品。**

当前项目已经具备一套可运行的本地 AI coding agent 骨架：能扫描项目、组装上下文、调用工具、读写代码、运行验证、生成报告、回滚、接入长期记忆，并支持 Claude / OpenAI / DeepSeek / Qwen / Mock Provider。工程能力不是纸面设计，已经有全量测试支撑。

但成熟替代品还缺 4 个关键证明：

1. 真实 Provider 黄金路径：必须在固定 demo 仓库跑通真实代码修改闭环。
2. macOS 发布级顺畅度：必须在真实 macOS 或 `macos-latest` CI 跑通安装、测试、工具和记忆。
3. 过程透明：工具调用、采用记忆、验证/修复过程需要在 REPL/CLI 中稳定展示。
4. 发布级低噪音：lint warnings、非预期 stderr、长任务状态体验还要继续压。

## 二、验收基线

| 项目 | 结果 |
|------|------|
| TypeScript | `npx tsc --noEmit` 通过 |
| Lint | `npm run lint` 通过，0 errors / 158 warnings |
| 全量测试 | `npm test` 通过，116 test files / 1715 passed / 2 skipped |
| 代码能力定向测试 | 9 files / 171 passed |
| 文档/PDF/工具补漏测试 | 4 files / 105 passed |
| 代码能力验收文档 | `doc/ARCHITECT_ACCEPTANCE_CODE_CAPABILITY_2026-05-21.md` |

本次验收发现并修复：

- `web_search` 工具入口未传 `rootPath`，项目级磁盘缓存未真正接入主链路。
- `doc-reader.ts` 重复声明 `pdfParse`，导致全量测试中两个 doc-reader 套件加载失败。
- `read_pdf` 工具残留 PDF parser warning，影响工具结果展示洁净度。

修复后全量测试已通过。

## 三、重新评分

综合评分：**8.1 / 10**

| 能力 | 评分 | 验收判断 |
|------|------|----------|
| 本地工程执行能力 | 8.5 | 扫描、工具、命令、验证、回滚、审计均有基础闭环 |
| Claude Code 级代码能力 | 8.2 | 生成、修复、AI 测试、结构化 code review 已具备；真实 Provider 案例仍是短板 |
| 长期记忆能力 | 8.4 | Memory Kernel 强，AGENTS/CLAUDE 文件互操作已补；产品化编辑与透明展示不足 |
| 工具能力 | 8.4 | 12 类工具能力较完整，权限/过程展示仍要产品化 |
| 测试能力 | 8.7 | 全量 1715 passed，质量门禁可信；warning 和 CI 分层需继续优化 |
| macOS 顺畅度 | 7.4 | 已有跨平台设计和标准，但缺真实 macOS 验收结果 |
| 架构可维护性 | 7.3 | 分层清晰，`index.ts` / `repl.ts` 仍是主要风险 |
| 产品可用性 | 7.0 | CLI 可演示，真实交付案例和长任务体验还不足 |
| 安全与可控性 | 7.9 | 路径、命令、提交、回滚已有基础；沙箱审批还需产品化 |

## 四、体验评分

按当前定位，体验不能只按“命令能不能跑”打分，而要按用户把它当作 Claude Code / Codex 替代品时的完整感受打分：启动是否顺、任务过程是否透明、改代码是否可信、失败时是否能理解和恢复、记忆是否真的帮上忙。

总体体验分：**7.2 / 10**

| 体验维度 | 分数 | 判断 |
|----------|------|------|
| 首次启动与安装 | 7.3 | mock provider、setup、doctor、JSON 输出已有基础；macOS 安装和非 git 目录体验仍需实测降噪 |
| 项目理解体验 | 8.0 | scan、overview、context、AST hints、记忆注入较完整，能给用户“它读懂项目”的感觉 |
| 代码交付体验 | 7.2 | 生成、修复、验证、回滚链路具备，但缺真实 Provider 黄金路径，用户还不能完全放心托付 |
| 工具执行可视化 | 7.0 | 首版工具进度已接入 REPL，但真实终端、多工具长任务、macOS/iTerm2 观感还没验收 |
| 长期记忆体验 | 7.4 | AGENTS/CLAUDE 导入导出是亮点，但缺 `ic mem edit`、采用记忆展示和任务后写回闭环 |
| 安全与掌控感 | 7.6 | 危险命令、路径、commit、rollback 基础不错；权限审批还偏工程化，不够产品化 |
| 失败恢复体验 | 7.0 | verify loop、rollback、report 已有，但错误提示、长任务恢复和噪音控制还要更细 |
| macOS 开发者体验 | 6.8 | 有跨平台设计和验收标准，但缺真实 macOS 端到端结果，因此不能高分 |
| 团队协作体验 | 6.2 | 审计和报告有基础，PR/Issue/commit 产品流不足，弱于成熟 coding agent |
| 发布信任感 | 6.9 | 全量测试可信，但 158 warnings、真实 Provider 案例不足、部分体验未实机验收会扣分 |

体验结论：

- 对内部工程师：**7.8/10**，已经能作为本地工程 agent 原型使用。
- 对种子用户：**7.2/10**，有条件可试用，但必须明确“候选替代品”定位。
- 对外宣称成熟 Claude Code / Codex 替代品：**6.5/10**，还不够，核心缺真实代码交付案例和跨平台顺畅证明。

提升体验分最快的 5 个动作：

1. 跑通真实 Provider 黄金路径，留下完整 diff、verify、repair、report 记录。
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

- 没有真实 Provider 在真实项目上完成完整任务的黄金路径记录。
- PR/Issue/commit 团队协作闭环不足。
- 工具调用和 diff/verify/repair 的体验还不如成熟 Claude Code 顺。

判断：**已经是替代品候选，不是成熟替代品。下一步必须用真实项目证明代码交付能力。**

### 3. 长期记忆系统

已可验收：

- Memory Kernel 已有 Sensory / Working / Episodic / Semantic 分层。
- 支持 `AGENTS.md`、`CLAUDE.md`、Copilot/Cursor 规则导入。
- 支持 `ic mem recall`、`ic mem import`、`ic mem export`、`ic mem manifests`。
- Node 18/20 有 JSONL/rules 降级路径，Node 24+ 可启用 SQLite 增强。
- 中文任务到英文代码/记忆匹配已修复过关键断裂。

不足：

- 缺 `ic mem edit`。
- 任务开始前没有清晰展示“本次采用了哪些记忆”。
- 任务结束后候选规则、用户确认、写回 `AGENTS.md` 还没形成一键闭环。

判断：**记忆能力是差异化优势，但还停留在内核强、产品体验弱。**

## 六、关键风险清单

| 优先级 | 风险 | 影响 | 处理建议 |
|--------|------|------|----------|
| P0 | 真实 Provider 黄金路径缺失 | 无法证明可替代 Claude Code/Codex 写真实代码 | 固定 demo 仓库跑全链路 |
| P0 | macOS 未实机验收 | macOS 是核心开发者平台，不能只靠源码推断 | `macos-latest` CI + 真实机器 smoke |
| P0 | 工具/记忆过程透明度不足 | 用户不清楚 agent 在做什么，信任感不足 | REPL/CLI 展示工具调用、采用记忆、验证阶段 |
| P1 | lint warnings 158 个 | 发布信任感弱 | 分批清理 warnings，不阻塞本次验收 |
| P1 | T9 验证并行化未实现 | 长任务反馈慢 | 先并行 compile/lint，coverage/e2e 保持串行 |
| P1 | `index.ts` / `repl.ts` 偏重 | 后续迭代风险变高 | 继续按 T8 拆分 |
| P1 | PR/Issue 闭环缺失 | 团队协作能力弱 | 先做本地 `ic pr create` / `ic issue plan` |

## 七、下一步行动

### Day 1-2：真实黄金路径

目标：证明它能真的替代 Claude Code 做一次代码交付。

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
