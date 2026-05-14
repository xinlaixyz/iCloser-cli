# S4 Agent OS Human Collaboration Memory

## 背景

用户新增核心需求：iCloser 需要支持 Agent OS 级别的“上下人处理模式”，即上层人类负责战略决策与审批，下层 Agent 负责任务执行、信息收集和记忆更新。

这要求当前的项目记忆 / 全局记忆从“自动记录”升级为“可审计、可自动压缩、可自动评级、可版本化”的闭环系统。用户不应该承担理解和审核全部记忆的负担。

## 已完成文档整合

- 新增 `doc/AGENT_OS_HUMAN_COLLAB_MEMORY.md`
- 更新 `doc/iCloser_Agent_Shell_完整需求文档.md`
  - T2 从“双层级记忆系统”升级为“分层可审计记忆系统”
  - 新增痛点 4.5：团队不知道哪些 Agent 经验能沉淀
  - 新增 T2-4：上下人处理模式与可审计记忆闭环
- 更新 `doc/ARCHITECTURE.md`
  - 增加 Human Governance / Auto Review Layer，强调零知识用户路径和自动治理
  - 增加短期/任务/长期/外部知识接口四层记忆说明
- 更新 `doc/DEVELOPMENT.md`
  - 新增 S4 阶段研发拆分和验收标准

## 后续研发拆分

### S4.1 Memory Metadata Unification

目标：统一短期、任务、长期记忆元数据。

状态：dev2 已完成第一阶段底层事件流。

已完成：
- `src/types.ts` 增加记忆元数据和用户输入事件类型。
- `src/core/memory.ts` 增加 `recordUserInputEvent()`、`loadUserInputEvents()`、`sanitizeUserInput()`。
- REPL 非空输入自动记录到 `.icloser/input-events.jsonl`。
- `/apikey` 隐藏输入只保存脱敏版本。
- `ic t` 任务描述会以 `task-description` 记录并关联 taskId。
- `ic rule` 约束会以 `rule` 记录。
- 旧 `.icloser/memory.json` 缺少 `inputEvents` 时自动兼容。

验收：
- 所有持久化记忆包含 `source`、`taskId`、`agentId`、`reviewStatus`、`version`、`evidence`
- 所有用户输入都进入短期记忆事件流，包括自然语言、命令、审批、拒绝、修正和新增约束
- 与任务相关的用户输入在任务完成后归档到任务记忆
- API Key、token、密钥、隐私内容必须脱敏，或只保留审计摘要
- 现有 `.icloser/memory.json` 兼容旧数据读取
- 单元测试覆盖旧数据迁移和新字段写入

dev1 S4.1.1 验收记录（2026-05-13）：
- `npm run build` 通过
- `npm run test` 通过
- `npm run smoke:memory` 通过 — 验证 input-events.jsonl 存在、事件种类、元数据字段、API Key 脱敏
- `npm run smoke:all` 通过 — memory step 在 repl-e2e 之后、release smoke 之前
- `ic memory events` 只读命令可用 — 最近 10 条脱敏摘要
- 不修改 `src/core/memory.ts` 核心写入逻辑
- 不把 API Key 明文写入日志、stdout、stderr

### S4.2 Automatic Memory Review for Zero-Knowledge Users

目标：长期知识进入自动审核与低负担确认流程。

状态：dev2 已完成核心自动评级与候选生成函数。

验收：
- 系统自动分类、压缩、去重和风险评级
- 低风险项目记忆自动归档
- 中风险候选批量待确认，不打断主流程
- 高风险候选用简单选择题即时确认，必须有推荐默认项
- 全局 approved 记忆必须来自明确用户确认或团队策略配置
- 新增查看/批准/拒绝候选的 CLI 或 REPL 命令，但普通用户主路径不依赖这些命令

已完成：
- `MemoryCandidate` / `MemoryCandidateKind` / `MemoryReviewAction` 类型。
- `ProjectMemory.memoryCandidates`。
- `createMemoryCandidateFromInputEvent()`。
- `classifyMemoryRisk()`。
- `compressMemoryCandidate()`。
- 自动去重。
- 低风险项目偏好自动 approved。
- 高风险数据库/schema 等规则 ask-now。
- 敏感输入 archived + ignore。

实测：
- `npm run test` 通过，15 files / 153 tests。

### S4.2.1 Memory Candidate Visibility

目标：把 S4.2 生成的候选记忆做成新手可理解的只读入口，先可见、可验收，再进入确认交互。

状态：dev2 已完成。

已完成：
- `ic mem candidates` 展示自动整理的记忆处理结果。
- 汇总展示“自动保存 / 待确认 / 已归档”。
- 候选列表展示类型、摘要、风险等级、状态和原因。
- 高风险 `ask-now` 候选显示为“需要确认”。
- 敏感输入只保留脱敏摘要。
- `npm run smoke:memory` 增加候选生成与 CLI 可见性验收。

验收：
- 低风险项目偏好自动保存，不打断用户。
- 高风险数据库/schema 规则进入待确认。
- `ic mem candidates` 不泄漏 API Key 明文。
- 普通用户可直接看懂系统记忆处理状态。

### S4.2.2 Beginner Memory Review Actions

目标：待确认记忆必须能用数字完成处理，不能要求用户猜 ID 或理解内部状态机。

状态：dev2 已完成。

已完成：
- `ic mem review` 显示待确认记忆和推荐命令。
- `ic mem approve 1` 保存第 1 条待确认记忆。
- `ic mem reject 1` 暂不保存第 1 条待确认记忆。
- 支持高级用户使用候选 ID 或 ID 前缀。
- 审核后同步更新候选状态和元数据状态。
- `npm run smoke:memory` 覆盖 review / approve / candidates 链路。

验收：
- 普通用户复制 `ic mem review` 即可知道下一步。
- 确认命令使用数字序号。
- approve 后候选统计中的“自动保存”增加。

### S4.3 Task Archive and Template Extraction

目标：任务完成后提取可复用模板。

状态：dev2 已完成第一版。

已完成：
- 完成任务进入 `recordTask()` 时自动提取 `template` 类型记忆候选。
- 模板候选默认 `proposed`，不会静默进入全局长期知识库。
- 主任务链路调整为先写任务记忆，再生成报告。
- `report.md` 增加“任务记忆候选”章节，展示候选类型、状态、风险、摘要。
- 报告中提示 `ic mem review`，让普通用户按数字确认。
- release smoke 增加报告候选记忆验收。

验收：
- 任务报告中展示本次产生的候选记忆和模板：已完成
- 模板默认 proposed：已完成
- 明确用户确认或团队策略允许后写入全局长期知识库：保留到 S4.3.1 / S4.4，不做静默全局写入

实测：
- `npm run build` 通过
- `npm run test` 通过，15 files / 154 tests
- `npm run smoke` 通过，报告包含“任务记忆候选 / 模板 / ic mem review”

### S4.3.1 Approved Template Context Retrieval

目标：用户确认后的模板候选需要进入后续任务上下文，让记忆真正被 Agent 使用。

状态：dev2 已完成。

已完成：
- `assembleRelevantMemory()` 注入 approved 记忆候选。
- proposed / archived / sensitive / task-only 不进入上下文。
- 已确认模板在上下文中显示为“已确认可复用记忆”。
- 按任务描述与候选摘要/内容做轻量相关性匹配。
- memory smoke 覆盖 `ic mem approve 1` 后 context 可见。

验收：
- approved 模板进入上下文：已完成。
- proposed 模板不进入上下文：已完成。
- 用户确认动作对后续任务有实际影响：已完成。

实测：
- `npm run build` 通过
- `npm run test -- tests/context.test.ts` 通过，3 tests
- `npm run smoke:memory` 通过

### S4.4 Agent Action Audit Log

目标：统一记录 Agent 动作、工具调用、文件读写和记忆更新。

状态：dev1 已完成核心审计日志和集成。

已完成：
- `src/types.ts` 新增 `AuditEvent` / `AuditActor` / `AuditAction` / `AuditResult` 类型。
- `src/core/audit.ts` 新增 `appendAuditEvent()` / `loadAuditEvents()` / `sanitizeAuditPayload()`。
- 审计日志落盘到 `.icloser/audit/events.jsonl`。
- `executeTask()` 中记录 6 类关键动作：task-started、ai-called、file-written、verify-run、report-generated、memory-updated。
- `ic t` 命令中记录 task-created。
- `sanitizeAuditPayload()` 脱敏 API Key / token / password / secret。
- `ic audit` CLI 只读查看最近 20 条审计事件。
- `ic audit --task <id>` 按任务过滤。
- 任务报告增加“审计日志”章节，显示本任务相关事件数和列表。
- `tests/audit.test.ts` 覆盖写入、读取、过滤、脱敏、空日志。
- `smoke:memory` 扩展审计验收：至少 5 条事件、覆盖 5 类动作、API Key 不落盘、CLI 可用。

验收：
- 每个 task report 可链接到审计事件
- 审计日志包含 actor、action、target、timestamp、result
- 敏感信息必须脱敏

dev1 S4.4 验收记录（2026-05-13）：
- `npm run build` 通过
- `npm run test` 通过，16 files / 164 tests（含 `tests/audit.test.ts` 7 个测试）
- `npm run smoke:memory` 通过 — 7 条审计事件，覆盖 task-created / task-started / ai-called / file-written / verify-run / memory-updated / report-generated
- `npm run smoke:all` 通过 — memory step 在 repl-e2e 之后、release smoke 之前
- `ic audit` CLI 可用 — 最近 20 条，按 taskId 过滤
- task report 含审计日志章节 — 事件数 + 列表 + `ic audit` 提示
- `ic audit --task <id>` 按任务过滤正常
- 不在 `src/core/context.ts` 中修改记忆检索逻辑
- API Key / token / password / secret 双重脱敏（key 名 + value 模式）

### dev1 REPL UX 改进（2026-05-13）

在 S4 期间同步完成，未创建独立 S 编号。

已完成：
- **底部栏删除** — `printBottomBlock()` 变为空操作，删除固定的快捷入口栏。
- **AI 回复去框架** — 删除 `── AI ──` 满宽分隔头和 `┌json`/`└` 代码块重型框，改用 `\`\`\`` 简洁标记。
- **分隔线精简** — Token 行和代码块分隔改用简短格式，不再撑满终端宽度。
- **文件确认内联** — AI 生成文件后不跳到底部栏，直接在对话流中显示：
  ```
  ▸ hello.txt (+3)  ▸ guide.txt (+3)
  [1] Write  [2] Diff  [3] Cancel
  ```
- **命令确认改数字选择** — `/write`、`/commit`、`/undo` 不再直接执行，先显示确认提示：
  - `/write` → `[1] Write  [2] Diff  [3] Cancel`
  - `/commit` → 变更文件列表 + `[1] Commit  [2] Cancel`
  - `/undo` → 将撤销文件 + `[1] Undo  [2] Cancel`
- **输入框分隔线** — 提示符上方增加 dim 分隔线，视觉上划分对话区和输入区。
- **Tab 补全修复** — `/(empty)` 显示 10 个常用命令而非全部 24+；修复 `endsWithSpace` 边缘情况。
- **启动流程不变** — welcome、首次使用引导、statusBar 保持原样。

验收：
- `npm run build` 通过
- `npm run test` 通过，164 tests
- `npm run smoke:repl` 通过，21/21
- `npm run smoke:repl:e2e` 通过，23/23
- `npm run smoke:all` 通过
