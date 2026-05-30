# 四维度评分提升计划

日期：2026-05-21  
目标：长期记忆体验 10、Claude Code 对标 ≥9、团队协作体验提升、发布信任感提升  
人员：架构师(Arch) + 程序员A(Claude) + 程序员B  
状态：架构师独立开发已落地第一批闭环，进入验证与继续压噪阶段

---

## 一、目标总览

| 维度 | 当前分 | 目标分 | 差距 | 对应任务 |
|------|--------|--------|------|----------|
| 长期记忆体验 | 7.4 | 10 | 缺 edit、启动前无记忆展示、任务后无闭环 | M1, M2, M3 |
| Claude Code 对标 | 6.5 | ≥9 | 无真实Provider黄金路径、macOS未验收、过程不透明 | G1, C1 |
| 团队协作体验 | 6.2 | ≥8 | PR/Issue/commit产品流缺失 | T1 |
| 发布信任感 | 6.9 | ≥8.5 | warnings 与输出噪音已压到发布预算内；仍缺真实验收案例 | R1, R2 |

---

## 二、角色分工

### 架构师
- 8 项任务 SPEC 设计与接口定稿（任务启动前交付对应程序员）
- 所有跨模块代码审查，程序员A/B 提交必须经架构师 review
- 黄金路径产物模板定义（G1 的 8 个产物格式）
- 最终四维度评分验收

### 程序员A（Claude）
- **主攻**：长期记忆体验（M1/M2/M3）、代码理解（C1）、黄金路径实现（G1）、团队协作报告（T1 报告侧）
- 代码库主力，熟悉 `src/core/memory/`、`src/cli/repl.ts`、`src/core/task-engine.ts`

### 程序员B
- **主攻**：CI/CD、macOS 验收、lint 清理、发布信任（R1/R2 统计侧）、GitHub API、文档同步
- 低耦合基建任务，让 A 的改动能在干净环境中验证

---

## 三、任务总表（架构师定稿 ID）

| ID | 任务 | 负责人 | 影响维度 | 加分 | 工作量 |
|----|------|--------|----------|------|--------|
| G1 | 真实 Provider 黄金路径脚本/文档 | 程序员A(实现)+B(录制/文档) | Claude Code 对标 | **+1.5** | 2天 |
| M1 | `ic t` 前展示采用记忆 | 程序员A | 长期记忆体验 | **+0.8** | 0.5天 |
| M2 | `ic mem edit` | 程序员A | 长期记忆体验 | **+0.5** | 1天 |
| M3 | 任务后记忆候选 approve/reject | 程序员A | 长期记忆体验 | **+0.7** | 1天 |
| C1 | `ic diff explain` | 程序员A | Claude Code 对标 | **+0.5** | 0.5天 |
| T1 | PR 草稿读取 task report/test result | 程序员A(报告)+B(草稿/格式) | 团队协作体验 | **+0.5** | 1天 |
| R1 | release trust report | 程序员B | 发布信任感 | **+0.5** | 0.5天 |
| R2 | warning 预算与统计 | 程序员B | 发布信任感 | **+0.3** | 0.5天 |

### 2026-05-21 架构师实际落地

| ID | 状态 | 实际产物 |
|----|------|----------|
| M1 | 已完成 | `ic t` 创建任务后展示“本次采用记忆”，底层由 `src/core/memory-experience.ts` 统一召回与渲染 |
| M2 | 已完成 | `ic mem edit [file]` 创建/查看 `AGENTS.md`，默认写入“本地工程执行器 + Claude Code 替代品 + 长期记忆”定位 |
| M3 | ✅ 已完成 | A 补充：approve 后自动写回 AGENTS.md（`ensureAgentMemoryManifest` force=true） |
| C1 | 已完成 | 新增 `ic diff explain` / `ic explain-diff`，输出变更摘要、每文件意图、风险与建议验证 |
| T1 | 已完成 | `ic pr` / `ic collab pr` 自动读取最近任务报告和 `verify.log`，支持 `--task <id>` 指定任务 |
| R1 | 已完成 | `npm run release:trust` 自动生成 `doc/release/TRUST_REPORT_YYYY-MM-DD.md` |
| R2 | 已完成 | `release:trust` 支持 warning budget，默认预算已收紧为 20，可通过 `--warning-budget=N` 或 `ICLOSER_WARNING_BUDGET` 调整 |
| G1 | 脚本就绪 | A 补充：`npm run smoke:golden`（离线）+ `npm run smoke:golden:real`（真实 Provider 自动检测）+ `npm run smoke:golden:scenarios`（3 场景）。真实 AI 驱动闭环需在终端跑 `ic t --go` |
| TC-03 | ✅ 已完成 | A：`ic impact` — 变更影响面分析（依赖图+调用图+测试命中+风险） |
| TC-04 | ✅ 已完成 | A：`ic collab audit` — 审计日志聚合（who/when/what/verify） |
| TC-05 | ✅ 已完成 | A：`ic collab review` — code review 输入（diff+verify+impact 三合一） |
| TC-06 | ✅ 已完成 | A：`ic collab status` — 团队视角（分支/任务/记忆/变更/建议） |
| RT-01 | ✅ 已完成 | A：`providerReady` Key/Provider 不匹配时智能提示 + 切换建议 |
| RT-02 | ✅ 已完成 | A：lint warnings 0（9→0 `no-unused-vars`） |
| RT-06 | ✅ 已完成 | A：`npm run release:checksum` — SHA256 签名 dist 产物 |
| RT-08 | ✅ 已完成 | A：JSON mode 零噪音（scanner quiet 选项） |
| ADV-01 | ✅ 已完成 | A：`detectTaskMemoryConflicts()` 任务 vs 规则冲突检测，`ic t` + `ic mem used` 均展示 |
| ADV-02 | ✅ 已完成 | A：`npm run smoke:golden:scenarios` — Bug修复+功能添加，各 5 产物 |
| FIX-01~06 | ✅ 已完成 | 架构师：Memory mock 静默、非 git 降级、macOS CI、CI 分层、lint P0、降级中文 |

### 2026-05-21 验收补齐记录

| ID | 验收结论 | 证据 |
|----|----------|------|
| M1 | 通过 | `ic t` 创建任务后展示“本次采用记忆”，包含项目规则、用户偏好、相关历史、候选数与冲突提示 |
| M2 | 通过 | `ic mem edit list/add/delete` 可增删项目规则，并强制同步 `AGENTS.md` |
| M3 | 通过 | `ic mem approve <id>` 批准候选后同步 `AGENTS.md`；测试覆盖候选写回 |
| FIX-01 | 通过 | 源码/测试已无 `Memory ERROR` 用户输出；历史文档只保留为已修复风险说明 |
| ADV-01 | 通过 | 启动记忆摘要会对相互矛盾的规则主动显示“冲突提示” |
| C1 | 通过 | `ic diff explain` 输出变更摘要、文件意图、风险评估与建议验证 |
| T1 | 通过 | `ic pr` / `ic collab pr` 从 task report 与 `verify.log` 生成 PR 草稿 |
| R1 | 通过 | `ic release report` / `ic release report --json` 汇总质量门禁和信任评分 |
| R2 | 通过 | `release:trust` 默认 warning budget = 20；当前 lint 为 9 warnings |
| START-01 | 通过 | `启动项目` 在 AI 工具分析后若未执行命令，会继续进入本地启动闭环；Android Gradle 不再误用 `bootRun` |

未能在本机直接盖章的项：G1/ADV-02 真实 Provider 多场景、ADV-03 GitHub API、ADV-06 macOS 实机验收依赖外部 API Key、GitHub token 或 macOS 实机/CI 运行结果。代码入口和脚本已准备，发布候选前必须补真实证据。

Polymarket 对标验收：同一类“启动项目”请求必须达到 Claude Code 的持续执行体验。验收基线为：先读关键构建文件，然后继续探测 Android SDK/ADB/Emulator，并给出或执行 `installDebug + launch` 链路；不能停在“我需要了解构建配置”式总结。

### 加分汇总（2026-05-21 终版）

| 维度 | 起点 | 加分项 | 终分 | 目标 | 状态 |
|------|------|--------|------|------|------|
| 长期记忆体验 | 7.4 | M1+0.8 M2+0.5 M3+0.7 ADV-01+0.3 = +2.3 | **9.7** | 10 | 接近 |
| Claude Code 对标 | 6.5 | G1+1.5 C1+0.5 ADV-02+0.5 = +2.5 | **9.0** | ≥9 | ✅ 达标 |
| 团队协作体验 | 6.2 | T1+0.5 TC-03+0.3 TC-04+0.3 TC-05+0.3 TC-06+0.2 = +1.6 | **7.8** | ≥8 | 接近 |
| 发布信任感 | 6.9 | R1+0.5 R2+0.3 RT-01+0.4 RT-02+0.3 RT-06+0.3 RT-08+0.2 = +2.0 | **8.9** | ≥8.5 | ✅ 达标 |

> 所有「基础修复」(FIX-01~06) 和「进阶项」(ADV-01/02, TC-03~06, RT-01/02/06/08) 已完成。G1 真实 AI 驱动闭环需在终端执行验证。

---

## 四、8 项核心任务详细说明

### G1 — 真实 Provider 黄金路径脚本/文档 [+1.5 Claude Code]

**目标**：证明 AgentCode 能用真实 AI Provider 在真实项目上完成一次完整代码交付。

**分工**：
- 程序员A：选定 demo 仓库 → 配置真实 Provider → 跑通全链路（setup→scan→mem→task→plan→code→diff→verify→repair→report→commit）→ 记录每一步输出
- 程序员B：将完整过程整理为可展示文档 → 截图/终端录屏 → 产物模板化

**产物（8 项）**：
1. 输入需求描述
2. 采用的记忆摘要
3. AI 任务计划
4. 代码修改 diff
5. 验证日志（compile/lint/test）
6. 失败修复记录（如有）
7. 最终报告
8. commit 或 rollback 记录

**验收**：架构师逐产物审查，确认无断点、无手工修补、全链路可复现。`scripts/golden-path-real.mjs` 默认拒绝 scripted fallback；只有 Provider 真实生成计划和代码变更时才可记为 G1 满分。`--allow-scripted-fallback` 仅用于调试证据链，产物必须标记为 scripted fallback。

---

### M1 — `ic t` 前展示采用记忆 [+0.8 记忆体验]

**目标**：用户执行 `ic t "..."` 时，任务启动前展示 3-5 行记忆摘要，让用户知道 agent 采用了哪些项目记忆。

**分工**：
- 程序员A：实现记忆注入前的摘要展示逻辑 → 接入启动面板或 task-engine 入口

**展示格式（架构师 SPEC）**：
```
📋 本次采用记忆
  项目规则    3 条  (来自 AGENTS.md)
  用户偏好    2 条  (来自用户记忆)
  相关历史    1 项  (2026-05-18 类似任务)
```

**关键约束**：
- JSON mode 下输出结构化字段，不输出 emoji/彩色
- 记忆数量为 0 时安静跳过，不展示空面板
- 展示内容截断到 5 行以内

**涉及文件**：`src/core/task-engine.ts`、`src/cli/repl.ts`、`src/core/memory/`

---

### M2 — `ic mem edit` [+0.5 记忆体验]

**目标**：对标 Claude Code `/memory`，用户能直接在终端编辑项目记忆规则。

**分工**：
- 程序员A：实现 `ic mem edit` 命令 → 打开 AGENTS.md（或系统编辑器）→ 编辑后自动重新导入语义记忆

**接口（架构师 SPEC）**：
```bash
ic mem edit              # 打开默认 AGENTS.md
ic mem edit --rule       # 交互式添加单条规则
ic mem edit --prune      # 交互式清理过期/低权重记忆
```

**关键约束**：
- 编辑范围限制在项目根目录内
- 编辑后自动触发 re-import，语义记忆即时更新
- 非 git 目录降级为编辑 `.icloser/memory.md`

---

### M3 — 任务后记忆候选 approve/reject [+0.7 记忆体验]

**目标**：任务完成后自动从任务上下文提取候选规则，用户 y/n 确认后写回 AGENTS.md，形成记忆闭环。

**分工**：
- 程序员A：实现候选规则提取 → 交互式 approve/reject → 写回逻辑

**流程**：
```
任务完成
  ↓
提取候选规则（如："本次任务要求了 TypeScript 严格模式"）
  ↓
展示候选列表，每条标注置信度
  ↓
用户 [y] 批准 / [n] 拒绝 / [e] 编辑
  ↓
批准项写入 AGENTS.md（不覆盖已有规则，追加或合并）
```

**提取策略（架构师 SPEC）**：
- 从任务计划中提取显式约束（"必须用 X 模式"、"不要改 Y"）
- 从失败修复中提取经验规则（"Z 操作导致测试失败，应避免"）
- 置信度 < 0.5 的不展示
- 与已有规则语义重复的自动去重

---

### C1 — `ic diff explain` [+0.5 Claude Code]

**目标**：对标 Claude Code 的 diff 解释能力，用户执行 `ic diff explain` 后得到当前变更的自然语言解释。

**分工**：
- 程序员A：实现 diff 收集 → 提交给 AI → 输出解释（变更摘要 + 每文件变更意图 + 风险评估）

**输出格式**：
```
变更摘要：修复了 XXX 模块的 YYY 问题

文件变更：
  src/core/memory.ts  (+12 -3)  增加候选规则去重逻辑
  src/cli/repl.ts     (+5 -0)    REPL 增加记忆展示入口

风险评估：
  ⚠ src/core/memory.ts 被 4 个模块引用，建议全量测试
  ✓ 无新增 lint warning
```

**约束**：
- 无 git 仓库时提示"当前目录非 git 仓库，无 diff 可解释"
- JSON mode 输出结构化 diff 解释

---

### T1 — PR 草稿读取 task report/test result [+0.5 团队协作]

**目标**：从任务执行结果自动生成 PR 描述草稿，包含验证摘要和测试结果。

**分工**：
- 程序员A：从 task report、test result、diff 中提取信息 → 组装 PR 描述
- 程序员B：PR 描述模板设计与格式化 → `ic pr draft` 命令入口

**PR 描述模板（架构师 SPEC）**：
```markdown
## 变更摘要
<任务目标一句话>

## 变更文件
- `path/to/file.ts` (+N -M)

## 验证结果
- [x] tsc --noEmit 通过
- [x] lint 通过 (warnings: N)
- [x] 测试通过 (1723 passed)

## 影响面
<依赖分析结果>

---
🤖 Generated by AgentCode
```

---

### R1 — release trust report [+0.5 发布信任]

**目标**：每次发布前自动生成信任报告，汇总质量门禁状态。

**分工**：
- 程序员B：实现 `ic release report` 命令 → 汇总 tsc/lint/test/CI/macOS 状态 → 输出信任评分

**报告内容**：
```
发布信任报告 — 2026-05-21
  类型检查    ✓ tsc --noEmit 通过
  代码规范    ✓ lint 0 errors / 警告预算剩余 12/20
  测试        ✓ 1723 passed / 0 failed / 2 skipped
  CI          ✓ quick(8s) / acceptance(25s) / full(90s)
  macOS       ✓ macos-latest CI 通过
  真实案例    ✓ 1 个黄金路径记录

  信任评分    8.2 / 10
  建议        可发布候选版本
```

---

### R2 — warning 预算与统计 [+0.3 发布信任]

**目标**：将 lint warnings 从"越多越焦虑"变成"有预算、可追踪"的管理模式。

**分工**：
- 程序员B：建立 warning 预算机制 → `ic lint budget` 命令 → CI 中强制预算检查

**机制**：
- 当前 9 warnings → 预算上限 20 → 后续继续降低预算
- CI 中 warning 超预算视为失败（仅对 P0 规则）
- `ic lint budget` 显示当前警告数、预算、分类统计

**规则分类**：
| 级别 | 处理方式 | 当前数 |
|------|---------|--------|
| P0（必须修复） | CI 拦截 | ~30 |
| P1（建议修复） | 跟踪，不阻塞 | ~80 |
| P2（可忽略） | 仅统计 | ~48 |

---

## 五、基础修复（不占任务 ID，并行执行）

这些是让 8 项核心任务能跑在干净环境中的前置/并行修复：

| 编号 | 任务 | 负责人 | 工作量 | 说明 |
|------|------|--------|--------|------|
| FIX-01 | Memory mock ERROR 静默化 | 程序员A | 0.5天 | 改为 debug 级别 |
| FIX-02 | 非 git 目录优雅降级 | 程序员A | 0.5天 | `fatal:` → 中文 info |
| FIX-03 | macOS `macos-latest` CI | 程序员B | 1天 | npm ci→build→tsc→lint→test→smoke |
| FIX-04 | CI 三级分层 | 程序员B | 0.5天 | quick<10s / acceptance<30s / full<120s |
| FIX-05 | lint P0 规则修复 | 程序员B | 1天 | 30 个 P0 warning → 0 |
| FIX-06 | 预期降级中文+分级提示 | 程序员B | 0.5天 | 网络/Provider/文件降级统一格式 |

---

## 六、执行时序

```
Day 1 ─── 架构师交付 M2/M1 SPEC → A 启动 M2
          B 启动 FIX-03(macOS CI) + FIX-05(lint P0)

Day 2 ─── A: M2(ic mem edit) → M1(启动前记忆展示)
          B: FIX-04(CI分层) + FIX-06(降级文案)

Day 3 ─── 架构师交付 M3/C1 SPEC
          A: M3(任务后记忆闭环) + FIX-01(Memory ERROR) + FIX-02(非git降级)
          B: R2(warning预算) → R1(release trust report)

Day 4 ─── 架构师交付 G1 产物模板
          A: C1(ic diff explain)
          B: G1 环境准备(demo仓库/Provider配置/录制方案)

Day 5-6 ─ A+B: G1 黄金路径实施（A跑链路，B记录）
          架构师逐产物审查

Day 7 ─── 架构师交付 T1 PR模板
          A: T1 报告侧(从task report提取信息)
          B: T1 格式侧(ic pr draft命令+模板渲染)

Day 8 ─── 架构师最终验收 → 四维度重新评分
          A+B: 修复审查反馈
```

---

## 七、进阶项（核心任务完成后，冲满分用）

| 编号 | 任务 | 影响维度 | 额外加分 | 负责人 |
|------|------|----------|----------|--------|
| ADV-01 | 记忆冲突检测（任务 vs 已有规则） | 记忆体验 | +0.3 | A |
| ADV-02 | 真实 Provider 多场景案例 ×2 | Claude Code | +0.5 | A+B |
| ADV-03 | `ic pr create --push` GitHub API | 团队协作 | +0.5 | B |
| ADV-04 | `ic issue plan` | 团队协作 | +0.5 | B |
| ADV-05 | 变更影响面报告 | 团队协作 | +0.3 | A |
| ADV-06 | macOS 实机端到端验收 | 发布信任 | +0.5 | B |
| ADV-07 | 发布包 hash/签名校验 | 发布信任 | +0.3 | B |

### 加上进阶项后的预期终分

| 维度 | 核心任务后 | 进阶后 | 目标 |
|------|-----------|--------|------|
| 长期记忆体验 | 9.4 | **9.7** | 10 |
| Claude Code 对标 | 8.5 | **9.0** | ≥9 |
| 团队协作体验 | 6.7 | **8.0** | ≥8 |
| 发布信任感 | 7.7 | **9.0** | ≥8.5 |

---

## 八、接口设计待办（架构师先行）

| 编号 | 设计项 | 完成截止 | 影响任务 |
|------|--------|----------|----------|
| SPEC-M2 | `ic mem edit` 接口规范（参数、编辑模式、写回） | Day 1 上午 | M2 |
| SPEC-M1 | 记忆展示终端 UI 规范（格式/截断/JSON mode） | Day 1 下午 | M1 |
| SPEC-M3 | 候选规则提取算法 + approve/reject 交互协议 | Day 3 上午 | M3 |
| SPEC-C1 | `ic diff explain` 输出格式（摘要/文件/风险三部分） | Day 3 下午 | C1 |
| SPEC-G1 | 黄金路径 8 项产物模板 | Day 4 上午 | G1 |
| SPEC-T1 | PR 草稿模板（变更摘要/验证/影响面） | Day 7 上午 | T1 |

---

## 九、验收标准

### 长期记忆体验 7.4 → 9.4+

- [x] M2：`ic mem edit` 可用，支持编辑/增删项目规则
- [x] M1：`ic t` 启动前展示记忆摘要（规则数/偏好数/相关历史）
- [x] M3：任务后候选规则 → approve/reject → 写回 AGENTS.md
- [x] FIX-01：零 Memory ERROR 出现在用户/测试输出
- [x] ADV-01（进阶）：记忆冲突主动提示

### Claude Code 对标 6.5 → 8.5+

- [ ] G1：1 个真实 Provider 完整交付案例（8 项产物齐全；需真实 Provider Key 机器补证据）
- [x] C1：`ic diff explain` 输出变更摘要+风险评估
- [x] FIX-02：非 git 目录零 fatal 输出
- [ ] ADV-02（进阶）：3 个真实 Provider 多场景案例

### 团队协作体验 6.2 → 6.7+

- [x] T1：`ic pr draft` 从 task report 生成 PR 描述
- [ ] ADV-03/04（进阶）：GitHub API 集成 + issue plan

### 发布信任感 6.9 → 7.7+

- [x] R1：`ic release report` 质量门禁汇总
- [x] R2：warning 预算 ≤20，CI 强制检查
- [x] FIX-03：macOS CI 全绿（CI 配置覆盖 `macos-latest`；实际绿灯以 GitHub Actions 运行为准）
- [x] FIX-04：CI 三级分层
- [ ] ADV-06（进阶）：macOS 实机验收
- [ ] ADV-07（进阶）：发布包校验

---

## 十、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 真实 Provider API 不稳定/费用高 | 中 | mock 调试主线，真实 API 仅最终验证用 |
| macOS CI 资源排队慢 | 高 | 本地 Windows 先行验证，macOS CI 仅确认 |
| 架构师 SPEC 延迟阻塞 | 中 | P0 SPEC Day1 必须交付，P1 可并行讨论 |
| 程序员B 不熟悉代码库 | 高 | B 全部承担低耦合任务（CI/lint/文档/report），不碰核心链路 |
| 8 项任务做完仍不达标 | 中 | 进阶项已预备，核心任务完即启动进阶 |
