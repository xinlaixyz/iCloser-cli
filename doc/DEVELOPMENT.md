# iCloser Agent Shell — 开发指南

## 一、环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | ≥ 18 | 运行时 |
| npm | ≥ 9 | 包管理 |
| Git | ≥ 2.30 | 版本控制 |
| TypeScript | 5.x | 开发语言 |

## 二、快速开始

```bash
# 1. 克隆项目
cd AgentCode

# 2. 安装依赖
npm install

# 3. 构建
npm run build

# 4. 全局链接（开发调试用）
npm link

# 5. 验证安装
iCloser --version
iCloser --help
```

## 三、开发命令

```bash
npm run build        # TypeScript 编译 → dist/
npm run dev          # tsx watch 模式，文件变更自动重载
npm run typecheck    # 仅类型检查，不输出文件
npm run clean        # 删除 dist/
npm run test         # 运行 Vitest 测试
```

S1 当前最低门槛：

```bash
npm run smoke
npm run smoke:project
```

阶段交接或完整验收门槛：

```bash
npm run smoke:all
```

或分步验证：

```bash
npm run build
npm run test
node dist/index.js init --force
node dist/index.js scan
```

通过后应至少确认：
- `.icloser/icloser.json` 中 `project.identity` 正确。
- `.icloser/index.json` 已生成。
- `loadProjectIndex(rootPath)` 读回后 `dependencyGraph` 是 `Map`。

### 发布前验收：Release Smoke

```bash
npm run smoke
```

`scripts/release-smoke.mjs` 自动执行完整验收链（无需 API Key）：

1. `npm run build` + `npm run test`
2. 创建临时项目 → `ic setup --mock --json`
3. `ic init` → `ic provider use mock` → `ic provider test --json`
4. `ic doctor --json` 确认项目已达到最小可执行状态
5. `ic t "..." --go`（完整 12 步管线：context → AI → write → verify → report → memory）
6. `ic status --json` → `ic gate --json`（gate passed = true）
7. `ic report`

退出码 0 表示可发布。所有 JSON 输出遵循统一 envelope（`version:1, kind, data`）。

调试临时项目：
```bash
ICLOSER_KEEP_SMOKE=1 npm run smoke
npm run smoke:keep
ICLOSER_KEEP_PROJECT_SMOKE=1 npm run smoke:project
```

CI 与分支策略：
- `.github/workflows/smoke.yml` 在 PR 和 push 到 `main`/`master` 时运行。
- **PR 合并门槛：必须 `npm run smoke` 通过。** CI 绿灯是合并的必要条件。
- CI 使用 Node 22、`npm ci`、`npm run smoke`。
- 所有 S1 代码进入主分支前必须本地通过 `npm run smoke`。
- `npm run smoke` 内建 build + test，mock provider 完成最小任务闭环，无需 API Key。
- `npm run smoke:project` 会创建一个临时 TypeScript 项目，验证 `ic doctor --strict --json`、任务写入、项目 build/lint/test、gate/report。
- `npm run smoke:all` 串行执行 build、test、first-run、REPL、release、real-project 全套验收，适合阶段交接前使用。
- CI 中可额外加入 `ic doctor --strict --json` 作为快速就绪门禁（未 init 或缺失索引时 exit 1），比完整 smoke 更轻量。

### S2 下一阶段研发计划

S2 目标是从“骨架可跑”推进到“真实 Provider + 真实项目可用”。

当前安排：
- dev1：S2.1 Real Provider Task Chain。
- dev2：S2.2 AI Output Contract。
- dev2 负责两条线的后续验收和集成结论。

详细分工、验收标准和 dev1 提示词见：
- `doc/S2_DEVELOPMENT_PLAN.md`
- `doc/tasks/2026-05-12-s2-next-stage-plan.md`

## 四、设置 AI Provider

开发时需要至少配置一个 AI Provider 的 API Key：

```powershell
# PowerShell
$env:DEEPSEEK_API_KEY = "sk-xxx"       # DeepSeek（推荐性价比）
$env:ANTHROPIC_API_KEY = "sk-ant-xxx"  # Claude（推荐复杂任务）
$env:OPENAI_API_KEY = "sk-xxx"         # OpenAI
$env:DASHSCOPE_API_KEY = "sk-xxx"      # 通义千问
```

离线验收可使用内置 mock provider，不需要 API Key：

```powershell
$env:ICLOSER_AI_PROVIDER = "mock"
iCloser init --force
iCloser t "修改 notes.txt 添加离线验收标记" --go
```

`mock` provider 会基于任务中显式提到的文件路径或上下文中最相关的文件，生成标准 AI Output Contract JSON，用于验证写文件、验证、报告、记忆等主链行为。它只用于本地验收，不代表真实 AI 代码质量。

## 五、项目结构导航

```
AgentCode/
├── src/
│   ├── index.ts              # ★ CLI 入口，所有 commander 命令注册
│   ├── config.ts             # 全局/项目配置管理
│   ├── types.ts              # ★ 核心类型（415行，所有模块共享）
│   │
│   ├── cli/                  # CLI 交互层
│   │   ├── repl.ts           # 交互式 REPL（最复杂的文件，1300+行）
│   │   ├── output.ts         # 格式化输出函数
│   │   ├── format.ts         # 纯函数状态/门禁 formatter
│   │   ├── json.ts           # 稳定 JSON 输出契约
│   │   └── theme.ts          # 终端 UI 设计系统
│   │
│   ├── core/                 # ★ 核心服务层（主要开发在这里）
│   │   ├── scanner.ts        # 项目扫描器
│   │   ├── task-engine.ts    # 任务引擎
│   │   ├── verifier.ts       # 验证引擎
│   │   ├── context.ts        # 上下文压缩管理器
│   │   ├── memory.ts         # 双层级记忆系统
│   │   └── security.ts       # 安全执行层
│   │
│   ├── agent/
│   │   └── manager.ts        # Agent 管理器
│   │
│   ├── gate/
│   │   └── checker.ts        # 门禁检查器
│   │
│   ├── ai/
│   │   ├── provider.ts       # AI Provider 适配层
│   │   └── errors.ts         # AI 错误分类（AICallError + classifyError）
│   │
│   ├── skill/
│   │   └── manager.ts        # Skill 管理器
│   │
│   ├── report/
│   │   └── generator.ts      # 报告生成器
│   │
│   └── utils/
│       ├── fs.ts             # 文件系统工具
│       ├── git.ts            # Git 命令封装
│       └── detect.ts         # 项目自动识别
│
├── diagrams/                 # 架构图（PNG）
├── doc/                      # 文档
│   └── tasks/                 # 历史任务记录（按日期归档）
├── tsconfig.json             # TypeScript 配置
└── .gitignore
```

## 六、模块开发指引

### 6.1 添加新的 AI Provider

在 `src/ai/provider.ts` 中新增一个类，实现 `AIProviderAdapter` 接口：

```typescript
export interface AIProviderAdapter {
  name: string;
  chat(prompt: AIPrompt, tools?: ToolDefinition[]): Promise<AIResponse>;
  chatStream(prompt: AIPrompt, onChunk: StreamCallback, tools?: ToolDefinition[]): Promise<AIResponse>;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  defaultModel: string;
  availableModels: string[];
}
```

然后在 `createProvider()` 工厂函数的 switch 中添加分支，并在 `getAvailableProviders()` 中注册。

### 6.2 添加新的验证阶段

在 `src/types.ts` 的 `VerifyStage` 类型中添加新值，然后在 `src/core/verifier.ts` 中：
1. 在 `runStage()` 的 switch 中添加新 case
2. 实现对应的 `run*()` 函数
3. 在 `get*Command()` 中添加对应语言的命令

### 6.3 添加新的 CLI 命令

在 `src/index.ts` 中用 commander API 添加子命令：

```typescript
program
  .command('command-name')
  .alias('cn')
  .description('命令描述')
  .argument('[arg]', '参数描述')
  .action(async (arg: string) => {
    // 实现
  });
```

### 6.4 添加新的 Skill

内置 Skill 在 `src/skill/manager.ts` 的 `BUILTIN_SKILLS` 数组中定义：

```typescript
{
  manifest: {
    name: 'my-skill',
    version: '1.0.0',
    description: '...',
    triggers: ['关键词1', '关键词2'],
    requires: ['project-index'],  // 依赖的其他 skill
    type: 'builtin',
    provider: 'claude',
  },
  systemPrompt: '你是...专家。...',
  tools: ['tool-name'],
  installed: true,
  enabled: true,
  installPath: 'builtin',
}
```

### 6.5 添加新的项目识别维度

在 `src/types.ts` 的 `ProjectIdentity` 接口中添加字段，然后在 `src/utils/detect.ts` 中实现检测逻辑，最后在 `src/core/scanner.ts` 的 `scanProject()` 中串联。

## 七、类型系统约定

- 所有类型定义集中在 `src/types.ts`，不分散到各模块
- 联合类型用于有限值集合（如 `LanguageType`, `FrameworkType`）
- 接口用于结构化数据（如 `Task`, `ProjectIndex`）
- 可选字段标记可能不存在的数据（如 `verifyResult?`, `plan?`）
- `Map` 类型用于需要频繁查找的数据（如 `dependencyGraph`, `fileLocks`）

### 添加新类型的标准格式

```typescript
// 1. 枚举/联合类型
export type NewType = 'value1' | 'value2' | 'value3';

// 2. 数据接口
export interface NewInterface {
  id: string;
  name: string;
  status: NewType;
  metadata?: Record<string, unknown>;  // 可选扩展字段
  createdAt: string;
}

// 3. 结果接口（用于函数返回值）
export interface NewResult {
  success: boolean;
  data: NewInterface[];
  errors: string[];
}
```

## 八、配置层级

配置分两层：

| 层级 | 路径 | 内容 |
|------|------|------|
| 全局 | `~/.icloser/config.json` | AI provider、model、API key |
| 项目 | `.icloser/icloser.json` | 项目身份、验证管线、已启用 Skills |

项目启动时，`loadConfig()` 自动合并全局 AI 配置到项目配置（项目级优先）。

## 九、调试技巧

### REPL 模式调试

```bash
# 直接进入交互式 REPL
iCloser

# REPL 内可用命令
/status    # 查看会话状态（provider/model/索引/Token 用量）
/config    # 查看/修改 AI 配置
/init      # 重新索引当前目录
/scan      # 扫描文件分布
/context   # 预览将注入 AI 的上下文文件和 token 预算
/verify    # 运行验证
/view 路径  # 高亮查看文件
/search 关键词  # 搜索代码
/deps 路径  # 查看依赖关系
/impact 路径 # 分析修改影响范围
```

### 查看运行时数据

```bash
# 查看项目配置
cat .icloser/icloser.json | jq

# 查看项目索引
cat .icloser/index.json | jq

# 查看项目记忆
cat .icloser/memory.json | jq

# 查看全局记忆
cat ~/.icloser/global-memory/memory.json | jq

# 查看审计日志
cat .icloser/audit.log
```

## 十、测试策略

| 测试层级 | 覆盖目标 | 框架 |
|---------|---------|------|
| 单元测试 | 每个模块的纯函数（scanner/detector/verifier/compressor） | vitest |
| 集成测试 | 模块间协作（detect → scan → context 流程） | vitest |
| CLI 测试 | 命令输入输出 | vitest + execSync |
| Provider Mock | AI 调用模拟 | vitest + MSW |

## 十一、S1 并行开发分工

当前项目处于骨架代码补实阶段。两位全栈工程师按闭环切分，而不是按 T1/T2/T3 横切。

### dev1：任务主链

负责把 CLI task 从 simulate 改成真实闭环：
- `src/index.ts`：替换 `simulateTaskPlan()` / `simulateTaskExecution()`。
- `src/core/task-engine.ts`：串起 `createTask()`、`generatePlan()`、`persistTask()`、状态流转、文件锁。
- `src/report/generator.ts`：生成真实 report、diff、reasoning 摘要。
- `src/gate/checker.ts`：先落地基础真实 gate。
- CLI 命令 `t/y/n/status/log/report/gate` 要读写 `.icloser/tasks/<task-id>/task.json`。

可直接依赖 dev2 已完成的入口：
- `loadConfig(rootPath)`
- `scanProject(...)`
- `saveProjectIndex(rootPath, index)`
- `loadProjectIndex(rootPath)`
- `assembleContextFromProject(rootPath, task, options)`
- `.icloser/index.json`

### dev2：项目理解、REPL、验证入口

负责让项目识别、索引、上下文和 REPL 可用：
- `src/utils/detect.ts`：项目身份识别。
- `src/core/scanner.ts`：项目索引、模块、API、依赖、风格指纹、索引持久化。
- `src/cli/repl.ts`：`/init`、`/scan`、`/verify`、`/search`、`/edit`、`/undo`。
- `src/core/context.ts`：下一步接入 `.icloser/index.json`，生成真实 `ContextPackage`。

### S1 已完成基线（2026-05-12）

- `npm run build` 通过。
- `npm run test` 通过。
- `detectProject()` 能识别 TypeScript/npm/vitest 与 Go/Gin/PostgreSQL。
- `iCloser init --force` 能正确写入项目身份。
- `iCloser scan` 调用核心 `scanProject()` 并写入 `.icloser/index.json`。
- `assembleContextFromProject()` 可从项目目录直接组装 `ContextPackage`。
- REPL 普通对话优先使用持久化索引组装 rich context。
- `mock` AI Provider 可用于无 API Key 的离线端到端验收。
- REPL `/verify` 不再吞失败。
- REPL `/search` 使用 `execFileSync('rg', args)`，避免 shell quoting 与 ripgrep 参数兼容问题。

### S1.11 Status 展示验收（2026-05-12）

`ic st <task-id>` 和 REPL `/status` 已完成验证状态增强。

**验收清单：**

```bash
# 1. 已完成任务 — 展示 stage / command / exitCode
iCloser config provider mock
iCloser t "修改某个文件添加验收标记" --go
iCloser st <task-id>
# 预期输出：验证阶段表格 + 每阶段图标/耗时/退出码/命令 + 失败阶段错误摘要

# 2. 未执行 queued 任务 — 展示 planned verification commands
iCloser t "测试预览任务"           # 不 --go，预览模式
iCloser st <task-id>
# 预期输出：「验证: 未执行」+「计划执行的验证命令」列表

# 3. 安全门禁阻塞 — 展示安全门禁摘要
iCloser gate <task-id>
# 预期输出：安全门禁行展示阻塞详情（▸ 逐条列出）

# 4. 纯 formatter 测试
npm run test -- tests/format-status.test.ts
# 14 个测试，覆盖 formatVerificationSummary / formatStageLine /
#   formatPlannedCommands / formatGateSummary / hasVerifyInfo / hasSecurityBlocking
```

**关键文件：**
- `src/cli/format.ts` — 纯函数 formatter，可脱离 CLI 独立测试
- `src/cli/json.ts` — JSON envelope serializer（`jsonEnvelope`/`serializeTask`/`serializeGateResult`/`serializeSecurityRules`），后续新增 `--json` 必须走这里
- `tests/format-status.test.ts` — 状态/门禁展示 formatter 测试
- `tests/json-contract.test.ts` — JSON 输出契约单元测试
- `tests/json-contract-spawn.test.ts` — JSON 输出 spawn 集成测试（验证 stdout 可 parse、无 ANSI 污染）
- `src/index.ts` — `printTaskDetail` / `printGateResult` 展示逻辑
- `src/cli/repl.ts` — `/status` 内 `printReplVerifyStatus`

**JSON envelope 规范：**
- 所有 `--json` 输出统一为 `{version: 1, kind: string, data: T}`
- 后续新增 `--json` 必须通过 `src/cli/json.ts` 的 serializer，禁止直接 `JSON.stringify` 内部对象
- stdout 不能混入 ANSI 颜色码或 spinner 文本

**状态输出规则：**
- 不打印完整 stdout/stderr，只保留失败摘要（前 5 行，跳过 warning 行）
- 不重新扫描文件，只读取已有 `task.verifyResult` / `task.gateResult`
- 未执行任务调用 `resolveVerificationCommand` 展示"将会执行"的命令
- 安全门禁优先展示 `SecurityIssue[]` 结构化数据（ruleId/severity/file:line/evidence）
- 老 task 无 structuredIssues 时 fallback 到 suggestion 文本

### S1.16 安全配置集成（2026-05-12）

**安全规则管理：**

```bash
# 查看全部规则及启用状态
ic config security rules

# 禁用/启用指定规则
ic config security disable secret-openai-key
ic config security enable secret-openai-key

# 查看安全配置摘要
ic config security
```

**规则列表（13 条，默认全部启用）：**
- secrets: `secret-openai-key`, `secret-aws-access-key`, `secret-private-key`, `secret-hardcoded-credential`
- dangerous-commands: `danger-rm-rf-root`, `danger-git-push-force`, `danger-chmod-777`, `danger-drop-database-object`
- sql-injection: `sql-string-concat`, `sql-template-interpolation`, `sql-query-concat`
- others: `sensitive-file-modified`, `path-traversal-change`

**安全扫描展示：**
- `ic st <task-id>` 在 gate 章节展示结构化安全阻塞
- 每行：severity(HIGH/MED/LOW) + file:line + ruleId + evidence 截断 100 字符
- `GateCheck.metadata.issues` 为空时 fallback 到 `suggestion` 文本

### S1.17 JSON 输出契约（2026-05-12）

**稳定 JSON envelope：**

所有脚本可消费的 JSON 输出统一使用：

```json
{
  "version": 1,
  "kind": "config | doctor | task-list | task | gate-result | security-rules | providers | provider-doctor | provider-test | setup",
  "data": {}
}
```

**当前入口：**

```bash
ic config --json                        # kind=config（不含 apiKey）
ic doctor --json                        # kind=doctor
ic st --json                            # kind=task-list
ic st --json
ic st <task-id> --json
ic gate <task-id> --json
ic config security rules --json
```

**规则：**
- JSON 模式下 stdout 必须是纯 JSON，不能混入 spinner/progress 文案。
- 对外脚本依赖 `version/kind/data`，不要直接依赖内部 `Task` / `GateResult` 原始结构。
- 新增 JSON 输出时优先在 `src/cli/json.ts` 增加 serializer，并在 `tests/json-contract.test.ts` 固定字段。

### S1.19 Provider 管理（2026-05-12）

**当前入口：**

```bash
ic provider list
ic provider list --json
ic provider use mock
ic provider use openai gpt-4o-mini
ic provider models openai
ic provider model gpt-4o
ic provider doctor
ic provider test
ic provider env openai
```

**API Key 策略：**
- 当前阶段推荐通过环境变量管理 Key，不在 CLI 中交互写入明文 Key。
- `mock` 不需要 API Key，适合本地 smoke/CI 骨架验收。
- 真实 Provider 会检查各自环境变量：
  - Claude: `ANTHROPIC_API_KEY`
  - DeepSeek: `DEEPSEEK_API_KEY`
  - OpenAI: `OPENAI_API_KEY`
  - Qwen: `QWEN_API_KEY` / `DASHSCOPE_API_KEY`

**连通性检查：**
- `ic provider doctor` 只检查配置和 Key 来源。
- `ic provider test` 会发一个极小 prompt，确认当前 Provider 真的能调用。
- `ic provider test --json` 输出 `kind: provider-test`，适合脚本/CI 使用。

### S1.21 Setup 重构（2026-05-12）

**当前入口：**

```bash
ic setup
ic setup --mock
ic setup --provider openai --model gpt-4o-mini
ic setup --json
```

**行为：**
- 不再硬编码请求 DeepSeek 网络。
- 如果检测到真实 Provider 的环境变量，优先选择该 Provider。
- 如果没有任何 API Key，默认选择 `mock`，保证本地 smoke 可以继续。
- 支持 `ICLOSER_HOME` 覆盖全局配置目录，默认仍是 `~/.icloser`。
- `setup --json` 输出 `kind: setup`，stdout 保持纯 JSON。

**报告重新生成：**
```bash
ic r --regenerate    # 强制重新生成 report.md + reasoning.md
ic r                 # 展示最新报告（存在则读取，不存在则自动生成）
```

### S1.24 Project Doctor（2026-05-12）

**当前入口：**

```bash
ic doctor
ic doctor --json
ic doctor --strict
ic doctor --strict --json
```

**行为：**
- 检查当前目录是否已执行 `ic init`。
- 检查 `.icloser/index.json` 是否存在。
- 汇总当前 Provider、模型、API Key 来源和可用性。
- 汇总任务数量。
- 根据缺口输出下一步动作，例如 `ic init` / `ic scan` / `ic provider env <name>` / `ic provider test` / `ic t "你的任务描述"`。
- `--strict` 模式下，如果 `data.ready = false`，进程退出码为 1，适合 CI/脚本门禁。

**JSON 输出：**
- `kind: doctor`
- `data.ready` 表示项目是否已达到最小可执行状态。
- stdout 必须保持纯 JSON，可用于 CI、脚本或后续 UI shell。

### S2.1 Real Provider Task Chain（2026-05-13）

**目标：** 把现有任务主链从 mock 演示推进到真实 Provider 可稳定执行。

**新增模块：**

- `src/ai/errors.ts` — AI 错误分类系统
  - `AICallError` 类：`code` + `provider` + `suggestion` + `raw`
  - `classifyError(err, provider, envVars, hasConfiguredKey)` — 工厂函数，8 种错误码
  - 错误码：`MISSING_API_KEY` / `AUTH_FAILED` / `NETWORK_ERROR` / `TIMEOUT` / `EMPTY_RESPONSE` / `INVALID_MODEL` / `RATE_LIMITED` / `UNKNOWN`

**错误处理升级：**

| 场景 | 之前 | 之后 |
|------|------|------|
| 缺少 API Key | `Missing API key. Set XXX_API_KEY` | `MISSING_API_KEY` + PowerShell/Bash 设置命令 |
| 鉴权失败 | `XXX API 调用失败: 401...` | `AUTH_FAILED` + 4 步排查指引 |
| 网络失败 | `XXX API 调用失败: fetch failed` | `NETWORK_ERROR` + 代理/防火墙检查 |
| 超时 | `XXX API 调用失败: timeout` | `TIMEOUT` + 简化任务/切换模型建议 |
| 无效模型 | `XXX API 调用失败: model not found` | `INVALID_MODEL` + 查看可用模型列表建议 |

**Provider 变更：**
- Claude/DeepSeek/OpenAI/Qwen 全部使用 `classifyError()` 替代裸 `throw new Error()`
- `smokeTestProvider()` 在错误消息中包含建议
- `executeTask()` 中 AI 调用失败时展示 `AICallError.toDisplay()`（原因 + 建议 + 原始错误）
- `printError()` 使用 duck-typing 检测 `toDisplay()` 协议

**测试覆盖：**
- 新增 13 个错误分类/验收修补测试（`tests/provider.test.ts`）
- 总测试数：79 → 92

**验收：**
- `npm run build` ✓
- `npm run test` ✓（92 通过）
- `npm run smoke` ✓
- mock provider 主链不退化
- 真实 Provider 失败路径包含明确原因和下一步建议

**相关文档：**
- `doc/tasks/2026-05-13-s2-real-provider-task-chain.md`
- `src/ai/errors.ts`

### S2.2 AI Output Contract（2026-05-13）

**目标：** 将模型输出收敛为稳定、可校验、可写入的结构，降低真实 Provider 自由文本导致的写入失败率。

**新增模块：**

- `src/ai/output-contract.ts`
  - `AIOutputContract`
  - `AIFileChange`
  - `AIOutputContractError`
  - `parseAIOutput()`
  - `validateAIOutputContract()`
  - `formatAIOutputContract()`

**协议结构：**

```json
{
  "summary": "本次修改摘要",
  "changes": [
    {
      "file": "相对路径",
      "operation": "write",
      "content": "完整文件内容",
      "reasoning": "为什么修改这个文件"
    }
  ]
}
```

**行为：**
- task 主链优先消费 `AIResponse.structuredOutput`，否则解析模型 `content`。
- mock provider 已改为输出同一结构，smoke 会覆盖协议。
- legacy `write:路径` 代码块仍兼容解析。
- 缺少 changes、空 changes、空 content、绝对路径、`..` 越界路径都会拒绝写入。
- 系统提示词已要求真实 Provider 输出 JSON contract。
- S2.4 后，如果真实 Provider 在 JSON 前后输出解释文本，解析器会扫描合法 JSON contract；没有合法 JSON 时仍拒绝写入。

**测试覆盖：**
- `tests/ai-output-contract.test.ts`
- 解析 fenced JSON。
- 解析 prose 包裹的 JSON contract。
- 兼容 legacy `write:`。
- 拒绝普通文本、空 changes、路径越界、绝对路径、不支持的 operation。
- 总测试数：92 → 101。

**验收：**
- `npm run build` ✓
- `npm run test` ✓（101 通过）
- `npm run smoke` ✓

### S2.3 Real Project Smoke Harness（2026-05-13）

**目标：** 将真实项目形态验收固化为脚本，避免只依赖极简 `notes.txt` release smoke。

**新增脚本：**

```bash
npm run smoke:project
```

**行为：**
- 自动执行根项目 `npm run build`。
- 创建临时 TypeScript 项目：
  - `package.json`
  - `tsconfig.json`
  - `src/math.ts`
  - `src/index.ts`
  - `scripts/check-build.mjs`
  - `scripts/check-lint.mjs`
  - `scripts/check-test.mjs`
- 运行：
  - `ic setup --mock --json`
  - `ic init --force`
  - `ic provider use mock`
  - `ic doctor --strict --json`
  - `ic provider test --json`
  - `ic t "修改 src/math.ts 添加真实项目验收标记" --go`
  - `ic status --json`
  - `ic gate <task-id> --json`
  - `ic report`
- 校验：
  - 项目被识别为 TypeScript。
  - doctor ready = true。
  - 任务 completed。
  - 修改文件包含 `src/math.ts`。
  - `src/math.ts` 包含 mock edit marker。
  - gate passed = true。

**调试：**

```bash
ICLOSER_KEEP_PROJECT_SMOKE=1 npm run smoke:project
```

### S2.3 Real Provider Live Acceptance（2026-05-13）

**目标：** 用真实 Provider（DeepSeek）在最小 TypeScript 项目中验证 S2.1 + S2.2 + S2.4 integration。

**S2.4 四项记录：**

| 问题 | 结果 |
|------|------|
| 模型是否严格输出 fenced JSON？ | 否 — DeepSeek 输出 bare JSON（`{...}`） |
| 是否输出 JSON 前后解释文字？ | 否 — 三次测试均无 prose |
| parseAIOutput 是否成功？ | 生产 prompt 下成功；宽松 prompt 下 `operation=modify` 被正确拒绝 |
| 失败时错误信息是否清楚？ | 是 — `changes[0] operation 仅支持 write` |

**实测结果：** 2 次独立任务执行均 completed（subtract + divide），gate passed=true。

**结论：** DeepSeek 稳定输出 bare JSON，严格 prompt 下 `operation=write` 遵从率 100%。S2.4 `findJsonObjectCandidates()` fallback 单元测试已覆盖，真实模型暂未触发。

**相关文档：**
- `doc/tasks/2026-05-13-s2-real-provider-live-acceptance.md`

### S2.5 REPL Output Contract Migration（2026-05-13）

**目标：** 让交互式 REPL 与 task 主链使用同一 AI Output Contract，减少两套输出协议带来的真实 Provider 差异。

**变更：**
- `src/cli/repl.ts` 引入 `parseAIOutput()`。
- REPL system prompt 改为要求 JSON contract：
  - `summary`
  - `changes[]`
  - `file`
  - `operation: write`
  - `content`
  - `reasoning`
- `/test` 生成命令也改为要求 AI Output Contract。
- `extractFileBlocks()` 优先解析 AI Output Contract，失败后保留 legacy `write:` 兜底。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`

**当前验收：**
- `npm run build` ✓
- `npm run test` ✓（101 通过）
- `npm run smoke:project` ✓
- `npm run smoke` ✓

**相关文档：**
- `doc/tasks/2026-05-13-s2-repl-output-contract.md`

### S2.6 No API Key Onboarding（2026-05-13）

**目标：** 真实环境里用户没有 API Key 时，系统仍然能启动，并直接给出可复制的配置格式。

**行为：**
- `ic setup --provider <real>` 缺少 Key 时展示 PowerShell / Bash / CMD 三种格式。
- `ic provider doctor` 和 `ic provider test` 复用同一套配置提示。
- `ic provider env <provider>` 输出完整格式、验证命令和无 Key 兜底命令。
- 直接运行 `ic` 进入 REPL 时，如果当前真实 Provider 没有 Key，自动切换到 `mock` 离线模式。
- REPL 会提示后续接入真实模型的命令，用户仍可先体验 `/status`、`/scan`、`/verify`、`/search` 和 mock 任务流。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`

**相关文档：**
- `doc/tasks/2026-05-13-s2-no-api-key-onboarding.md`

### S2.7 REPL Command Autocomplete（2026-05-13）

**目标：** 用户在 REPL 输入命令时支持 Tab 自动联想，降低首次使用和命令记忆成本。

**行为：**
- 输入 `/sta` 后按 Tab，可补全 `/status`。
- 输入 `/config p` 后按 Tab，可补全 `/config provider`。
- 输入 `/config provider de` 后按 Tab，可补全 `/config provider deepseek`。
- 输入 `/config model <prefix>` 后按 Tab，可按当前 Provider 的模型列表补全。
- 普通聊天内容不触发命令补全。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`

**相关文档：**
- `doc/tasks/2026-05-13-s2-repl-command-autocomplete.md`

### S2.8 Paste API Key Onboarding（2026-05-13）

**目标：** 面向完全不会配置环境变量的用户，支持直接粘贴 API Key 后自动接入真实 Provider。

**行为：**
- REPL 中直接粘贴 API Key 后回车，系统自动识别并保存。
- REPL 支持 `/apikey <key>` 和 `/apikey deepseek <key>`。
- 无 Key 自动 mock 时，提示“最简单：直接粘贴 API Key 后回车”。
- CLI 支持 `ic setup --key <api-key>`。
- CLI 支持 `ic provider key <api-key>` 和 `ic provider key deepseek <api-key>`。
- API Key 保存到全局用户配置，但 `ic config --json` 等 JSON 输出不暴露明文 Key。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`

**相关文档：**
- `doc/tasks/2026-05-13-s2-paste-api-key-onboarding.md`

### S2.9 Beginner First-Run Polish（2026-05-13）

**目标：** 把首次使用流程收敛到“打开 REPL → 粘贴 Key → 输入需求”三步，并减少新手遇到依赖/配置错误时的困惑。

**行为：**
- 用户输入“配置 key / 设置 key / 怎么配置 APIKey”等自然语言时，不发给模型，直接显示 Key 输入引导。
- Key 保存成功后，直接提示下一步示例需求。
- 无 Key 引导文案改为“把 API Key 粘贴到这里，然后回车”，不要求用户理解环境变量。
- 验证阶段遇到 `tsc` / `eslint` / `vitest` / `jest` 等命令缺失时，追加“请先运行 npm install”的新手提示。
- 修复全局真实 Provider 配置被新项目默认 Provider 覆盖的问题。

**真实 Provider 验收：**
- 使用 DeepSeek Key 验证 `setup --key`、`provider doctor`、`provider test`、真实任务执行、验证、gate。
- 结果：真实 DeepSeek 请求成功，`src/math.ts` 成功新增 `subtract()`，gate passed=true。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`

**相关文档：**
- `doc/NEW_USER_ONBOARDING.md`
- `doc/tasks/2026-05-13-s2-beginner-first-run-polish.md`

### S3.1 First-Run Wizard Acceptance & Hardening（2026-05-13）

**目标：** 验证并补强"完全不会用的人也能启动"的首轮体验。不做核心逻辑重构，优先验收脚本、边界测试和文档补强。

**新增验收脚本：**

```bash
npm run smoke:first-run
```

**新增测试：**
- `tests/first-run.test.ts` — 27 个测试，覆盖 JSON 安全、Key mask、Provider 推断、配置合并。

**first-run-smoke 8 项验证：**
- `setup --mock --json` 无 apiKey 泄露
- `setup --key <fake>` 不泄露明文 Key，keySource=config
- `config --json` 不包含 apiKey 字段
- `doctor --json` 继承全局 provider/model
- `provider doctor --json` keySource=config
- `provider list --json` 无 Key 泄露
- Mock 项目不被全局真实 Provider 覆盖
- 未知 Provider 不崩溃

**验收：**
- `npm run build` ✓
- `npm run test` ✓（14 文件，138 测试）
- `npm run smoke` ✓
- `npm run smoke:project` ✓
- `npm run smoke:first-run` ✓（8/8）

**相关文档：**
- `doc/tasks/2026-05-13-s3-first-run-wizard-acceptance.md`
- `doc/NEW_USER_ONBOARDING.md`

### S3.2 Secure API Key Prompt（2026-05-13）

**目标：** 普通用户不必把 API Key 写在命令行或明文显示在终端里。

**行为：**
- REPL 中输入 `/apikey` 会进入安全输入向导。
- 向导先询问 Provider，默认使用当前待配置 Provider 或 DeepSeek。
- API Key 输入阶段不回显。
- 空 Key 直接取消。
- 非 Key 格式会提示重新输入。
- 输入成功后沿用原有保存、脱敏展示、Provider smoke test、下一步需求提示。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke:first-run`
- `npm run smoke`
- `npm run smoke:project`

**相关文档：**
- `doc/tasks/2026-05-13-s3-secure-api-key-prompt.md`

### S3.3 REPL First-Run Interaction Smoke（2026-05-13）

**目标：** 增加真正的 REPL 交互验收，补全 first-run smoke 缺失的 TTY 交互覆盖。

**新增脚本：**

```bash
npm run smoke:repl
```

**行为：**
- spawn REPL（临时 HOME，无全局配置 → 触发 mock/key 引导）
- 输入"我要配置 key" → 不触发 AI chat，输出 Key 引导
- 输入 `/apikey` → 安全输入向导，默认 deepseek，fake key
- 验证输出不含明文 fake key
- 验证 `/status` 仍可工作
- 验证 `/exit` 正常退出（exit code 0）
- 验证全局 config.json 持久化

**测试覆盖：** 14 个断言，覆盖 startup / key-intent / wizard / masked-output / status / exit / persistence。

**验收：**
- `npm run build` ✓
- `npm run test` ✓
- `npm run smoke:first-run` ✓
- `npm run smoke:repl` ✓（14/14）
- `npm run smoke` ✓
- `npm run smoke:project` ✓

**相关文档：**
- `doc/tasks/2026-05-13-s3-repl-first-run-interaction-smoke.md`

### S3.4 REPL First Screen Guide（2026-05-13）

**目标：** 用户打开 `ic` 后一眼知道下一步，不需要记住命令。

**行为：**
- 未配置真实 Key 时，首屏显示三项：
  - 粘贴 API Key
  - `/apikey` 安全输入
  - 直接输入需求，先用 mock 离线体验
- 已配置真实 Provider 时，首屏显示三项：
  - 直接输入需求
  - `/scan`
  - `/status`
- 保留底部快捷命令区，不影响现有 REPL。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke:first-run`
- `npm run smoke`
- `npm run smoke:project`

**相关文档：**
- `doc/tasks/2026-05-13-s3-repl-first-screen-guide.md`

### S3.5 Full Acceptance Smoke Aggregator（2026-05-13）

**目标：** 将分散的验收脚本收束为一个阶段交接入口，降低人工漏跑风险。

**新增命令：**

```bash
npm run smoke:all
```

**执行顺序：**
1. `npm run build`
2. `npm run test`
3. `npm run smoke:first-run`
4. `npm run smoke:repl`
5. `npm run smoke:repl:init`
6. `npm run smoke:repl:e2e`
7. `npm run smoke:memory`
8. `npm run smoke`
9. `npm run smoke:project`

**验收：**
- `npm run smoke:all`

**相关文档：**
- `doc/tasks/2026-05-13-s3-full-smoke-aggregator.md`

### S3.7 Beginner Doctor Next Actions（2026-05-13）

**目标：** 让 `ic doctor` 对完全新手给出下一步，而不是只给工程师式诊断。

**行为：**
- 未初始化：提示 `ic init`，然后打开 `ic`。
- 缺 Provider Key：提示打开 `ic`，直接粘贴 API Key，或输入 `/apikey` 安全录入。
- 缺项目索引：提示 `ic scan`。
- 已 ready：提示 `ic t "你的任务描述"`。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke:all`

**相关文档：**
- `doc/tasks/2026-05-13-s3-beginner-doctor-next-actions.md`

### S3.8 REPL Doctor Readiness Guide（2026-05-13）

**目标：** 用户进入 REPL 后不需要退出到终端运行 `ic doctor`，可直接查看下一步。

**行为：**
- 新增 `/doctor` 命令。
- `/doctor` 在 REPL 内展示：
  - 项目是否初始化
  - Provider 是否 ready
  - 索引是否已生成
  - 下一步：`/init`、粘贴 API Key 或 `/apikey`、`/scan`、直接输入需求
- `/help` 与 Tab 补全包含 `/doctor`。
- `smoke:repl` 覆盖 `/doctor` 输出。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke:repl`
- `npm run smoke:all`

**相关文档：**
- `doc/tasks/2026-05-13-s3-repl-doctor-readiness-guide.md`

### S3.9 REPL Beginner End-to-End Smoke（2026-05-13）

**目标：** 新增一个真实新手路径 smoke，模拟完全新手在空项目中打开 `ic`，通过 REPL 内引导完成初始化、doctor 检查、mock 任务、写入、状态查看和退出。

**新增命令：**

```bash
npm run smoke:repl:e2e
```

**验收路径（13 步）：**
1. 创建临时空项目，写入最小 `package.json`，无全局配置
2. 启动 REPL → 进入 mock 离线模式
3. `/doctor` → 提示未初始化或 `/init`
4. `/init` → 项目识别成功
5. `/doctor` → ready 或下一步建议
6. 输入 "帮我创建 hello.txt 和 guide.txt，写入 iCloser beginner smoke"
7. mock AI 生成 hello.txt、guide.txt 两个 pending file
8. 输入 `1和2` 一次写入两个文件
9. `hello.txt` 和 `guide.txt` 存在于磁盘且包含 smoke 标记
10. `/status` 确认 REPL 仍可工作
11. `/exit` → exit code 0
12. stdout/stderr 不含真实 API Key
13. 无网络依赖，全程 mock

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke:repl`
- `npm run smoke:repl:e2e`
- `npm run smoke:all`

**相关文档：**
- `doc/tasks/2026-05-13-s3-repl-beginner-e2e-smoke.md`

### S3.10 REPL Init Refresh Persistence（2026-05-13）

**目标：** `/init` 和 `/scan` 在 REPL 中不仅刷新内存状态，也要更新项目配置和索引文件。

**行为：**
- `/init` 写入 `.icloser/icloser.json`。
- `/init` 扫描并写入 `.icloser/index.json`。
- `/scan` 刷新项目识别、内存索引和 `.icloser/index.json`。
- `/doctor` 在 `/init` 后立刻看到“已初始化 / 索引已生成”。

**新增命令：**

```bash
npm run smoke:repl:init
```

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke:repl:init`
- `npm run smoke:all`

**相关文档：**
- `doc/tasks/2026-05-13-s3-repl-init-refresh-persistence.md`

### S3.11 REPL Bottom Selection UX（2026-05-13）

**目标：** 修复用户看到底部文件写入选项后，不知道如何选择多个文件的问题。用户输入 `1和2`、`1,2`、`1 2`、`1-3` 或 `全部` 时，REPL 应按选项执行，而不是把它当成普通聊天继续发给 AI。

**行为：**
- 底部提示改为“输入 1 回车；多个用 1,2 或 1和2；输入 全部 写入所有文件”。
- 多选数字只匹配明确的选项表达，普通句子如 `1和2可以吗` 不会误触。
- `全部` 只写入全部待写入文件，不误触“预览变更”或“撤销”。
- 如果只写入一部分文件，剩余 pending files 会重新显示底部选项。
- mock provider 支持从任务中提取多个显式文件名，方便离线验收多文件写入。

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke:repl:e2e`
- `npm run smoke:all`

**相关文档：**
- `doc/tasks/2026-05-13-s3-repl-bottom-selection-ux.md`

## 十二、S4 Agent OS 上下人协同与记忆闭环

### S4.0 Human Collaboration Memory Design（2026-05-13）

**目标：** 将新增的 Agent OS 上下人处理模式整合进产品目标、架构和研发路线。该阶段不是单纯“记更多东西”，而是明确人类与 Agent 的权责边界：用户只负责表达目标和确认少数高风险动作，Agent OS 负责执行、记录、压缩、去重、风险评级和默认处理。

**核心模型：**

```text
Human Task Input
  → Agent Task Parsing & Decomposition
  → Subtasks Assigned to Agents
  → Short-term Memory Logging
  → Execution & Data Collection
  → Task Memory Update
  → Automatic Review / Compression
    ├─ Low Risk → Auto Archive / Auto Approve Project Memory
    ├─ Medium Risk → Batch Candidate, Ask Later
    └─ High Risk → Simple Human Choice
  → Archival / Template Extraction
```

**记忆分层：**
- 短期记忆：REPL session / task runtime，必须记录所有用户输入。
- 任务记忆：`.icloser/tasks/<task-id>/` 与 `.icloser/memory.json`。
- 长期知识库：`~/.icloser/global-memory/`，不能静默 approved，必须来自明确用户确认或团队策略配置。
- 外部知识接口：Provider / API / Search，默认实时查询，不持久化。

**研发拆分：**

1. `S4.1 Memory Metadata Unification`
   - 统一 `source`、`taskId`、`agentId`、`reviewStatus`、`version`、`evidence`。
   - 所有用户输入都写入短期记忆事件流，并能关联到 task/session。
   - API Key、token、密钥、隐私内容必须脱敏或只保存审计摘要。
   - 兼容旧 `.icloser/memory.json`。
   - 单测覆盖旧数据迁移和新字段写入。

2. `S4.2 Automatic Memory Review for Zero-Knowledge Users`
   - 系统自动分类、压缩、去重和风险评级。
   - 低风险项目记忆自动归档；中风险候选批量待确认；高风险用简单选择题即时确认。
   - 全局 approved 记忆必须来自明确用户确认或团队策略配置。
   - 新增查看/批准/拒绝候选的 CLI 或 REPL 命令，但普通用户不必须使用。

3. `S4.3 Task Archive and Template Extraction`
   - 从任务报告、验证日志、用户反馈中提取可复用模板。
   - 模板默认 proposed。
   - 人类批准后写入全局长期知识库。

4. `S4.4 Agent Action Audit Log`
   - 统一记录 Agent 动作、工具调用、文件读写、验证命令和记忆更新。
   - 任务报告可链接到审计事件。
   - 敏感信息必须脱敏。

**验收标准：**
- 每个任务完成后可以追溯：谁触发、哪个 Agent 执行、改了什么、验证结果是什么、沉淀了什么记忆。
- 每条用户输入都可追溯到短期记忆或任务记忆，敏感输入不泄露明文。
- 低风险记忆可自动归档，中高风险记忆必须有风险评级和默认建议。
- 全局长期知识不能静默 approved，必须来自明确用户确认或团队策略配置。
- 用户拒绝或修改记忆候选时，保留原始候选和修正版本。
- 普通用户无需运行 `ic memory` 也能完成主路径；高级用户可用 `ic memory` 区分 project / global / proposed / approved。

### S4.1.1 User Input Event Smoke + Readonly Visibility（2026-05-13）

**目标：** 为 S4.1 的用户输入事件流增加独立 smoke 验收和只读可见性，确保所有用户输入都进入 `.icloser/input-events.jsonl` 且敏感内容不泄漏。

**新增 smoke 脚本：**

```bash
npm run smoke:memory
```

**新增 CLI 命令：**

```bash
ic memory events     # 查看最近 10 条用户输入事件（已脱敏）
```

**smoke:memory 验收链：**
1. `npm run build` + 创建临时项目
2. `ic init --force`
3. `ic t "修改 notes.txt 添加 memory smoke 标记" --go` → 产生 task-description 事件
4. `ic rule "以后登录相关任务不要直接修改数据库 schema"` → 产生 rule 事件
5. `ic setup --provider deepseek --key <fake>` → 产生 api-key 事件
6. 验证 `.icloser/input-events.jsonl` 存在且至少 3 条事件
7. 验证包含 task-description 和 rule 两类事件
8. 验证所有事件 `metadata.source=user`、`metadata.reviewStatus=draft`
9. 验证 JSONL 不含明文 API Key
10. `loadUserInputEvents()` 可正确解析

**ic memory events 行为：**
- 读取 `.icloser/input-events.jsonl` 最近 10 条
- 每条显示时间、类型（任务/约束/命令/API Key/对话）、脱敏预览（截断 80 字符）
- 已脱敏事件标记黄色 ▸
- 不暴露原始 API Key 或敏感原文

**验收：**
- `npm run build`
- `npm run test`
- `npm run smoke:memory`
- `npm run smoke:all`

**相关文档：**
- `doc/tasks/2026-05-13-s4-agent-os-human-collab-memory.md`
- 任务报告展示系统自动处理了哪些记忆、哪些候选等待确认。

**相关文档：**
- `doc/AGENT_OS_HUMAN_COLLAB_MEMORY.md`
- `doc/tasks/2026-05-13-s4-agent-os-human-collab-memory.md`

### S4.2 Automatic Memory Candidate Review Core（2026-05-13）

**目标：** 先实现零知识用户记忆治理的底层判断能力，让系统自动从用户输入事件中提取候选记忆、压缩摘要、判断风险和决定默认处理方式。

**已实现：**
- `src/types.ts`
  - 新增 `MemoryCandidate`、`MemoryCandidateKind`、`MemoryReviewAction`。
  - `ProjectMemory` 增加 `memoryCandidates`。
- `src/core/memory.ts`
  - `recordUserInputEvent()` 写入事件后自动尝试生成 `MemoryCandidate`。
  - 新增 `createMemoryCandidateFromInputEvent()`。
  - 新增 `classifyMemoryRisk()`：识别低/中/高风险。
  - 新增 `compressMemoryCandidate()`：把用户原始表达压缩成规则/偏好/模板/事实摘要。
  - 自动去重，避免同一条候选重复沉淀。
  - 低风险项目偏好自动 `approved` + `auto-approve-project`。
  - 中风险候选进入 `proposed` + `batch-candidate`。
  - 数据库/schema/权限/安全/部署/支付等高风险内容进入 `proposed` + `ask-now`。
  - API Key/token/secret/password 等敏感内容进入 `archived` + `ignore`，只保留脱敏审计。
- `tests/memory.test.ts`
  - 覆盖低风险偏好自动批准、高风险 schema 规则 ask-now、敏感输入归档、压缩/风险分类确定性。

**验收：**
- `npm run test` ✓（15 files / 153 tests）

**下一步：**
- S4.2.1 将候选记忆接到只读展示和低负担确认交互：普通用户无需理解内部术语，高风险才出现推荐选项。

### S4.2.1 Memory Candidate Visibility（2026-05-13）

**目标：** 让完全新手不需要理解“记忆候选/审核状态”等内部概念，也能知道系统自动保存了什么、哪些内容需要确认。

**已实现：**
- `src/index.ts`
  - `ic mem candidates` 只读展示自动整理的记忆。
  - 输出聚合为“自动保存 / 待确认 / 已归档”，避免暴露复杂内部流程。
  - 高风险候选展示为“需要确认”，低风险偏好展示为“已自动保存”。
  - 敏感输入只展示脱敏审计摘要，不泄漏 API Key。
- `scripts/memory-event-smoke.mjs`
  - 增加 `memoryCandidates` 生成验收。
  - 增加 `ic mem candidates` 输出验收。
  - 验证高风险 schema 规则会进入 `ask-now` 候选。

**验收：**
- `npm run smoke:memory` 覆盖候选记忆只读展示。

**下一步：**
- S4.2.2 增加低负担确认动作：推荐默认选项 + 数字确认，不要求用户输入内部命令。

### S4.2.2 Beginner Memory Review Actions（2026-05-13）

**目标：** 待确认记忆不能停在“只读可见”，需要给完全新手一个数字式处理路径。

**已实现：**
- `src/index.ts`
  - `ic mem review` 展示最多 5 条待确认记忆，并给出推荐命令。
  - `ic mem approve 1` 保存第 1 条待确认记忆。
  - `ic mem reject 1` 暂不保存第 1 条待确认记忆。
  - 也支持候选 ID 或 ID 前缀，方便高级用户。
  - 审核后同步更新 `MemoryCandidate.reviewStatus` 与 `metadata.reviewStatus`。
- `scripts/memory-event-smoke.mjs`
  - 覆盖 `review → approve → candidates` 完整链路。

**验收：**
- 新手只需要复制 `ic mem review` 看到下一步。
- 处理命令只用数字，不要求用户理解内部 ID。
- `approve` 后 `ic mem candidates` 的“自动保存”数量会变化。

### S4.3 Task Archive and Template Extraction（2026-05-13）

**目标：** 任务完成后自动沉淀“可复用流程模板”，并在任务报告中展示本次产生的记忆候选，让记忆闭环从输入事件延伸到交付报告。

**已实现：**
- `src/core/memory.ts`
  - `recordTask()` 在记录完成任务时自动生成 `template` 类型 `MemoryCandidate`。
  - 新增 `createTaskTemplateCandidate()`：基于任务描述、变更文件、验证结果生成模板候选。
  - 模板候选默认 `reviewStatus=proposed`，不自动写入全局长期知识库。
  - 高风险任务模板走 `ask-now`，低/中风险任务模板进入批量待确认。
- `src/index.ts`
  - 主任务链路顺序调整为先更新任务记忆，再生成报告。
  - 保证报告能读取到本次任务刚产生的模板候选。
- `src/report/generator.ts`
  - 任务报告新增“任务记忆候选”章节。
  - 展示候选类型、状态、风险、摘要。
  - 给普通用户提示 `ic mem review`，不要求理解内部 ID。
- `scripts/release-smoke.mjs`
  - 增加报告中包含“任务记忆候选 / 模板 / ic mem review”的验收。
- `tests/report-gate.test.ts`
  - 增加报告展示任务模板候选的单元测试。

**验收：**
- `npm run build` ✓
- `npm run test` ✓（15 files / 154 tests）
- `npm run smoke` ✓

**下一步：**
- S4.3.1 让 `ic mem approve 1` 对模板候选产生更明确的后续效果：项目内 approved 模板可被 context 检索；全局模板仍需明确确认。

### S4.3.1 Approved Template Context Retrieval（2026-05-13）

**目标：** 用户确认后的模板不能只停在 `memory.json`，后续任务需要能在上下文中使用它。

**已实现：**
- `src/core/context.ts`
  - `assembleRelevantMemory()` 读取 `ProjectMemory.memoryCandidates`。
  - 仅注入 `reviewStatus=approved` 的候选记忆。
  - 排除 `sensitive` 和 `task-only` 候选。
  - 按任务描述与候选摘要/内容做轻量相关性匹配。
  - 输出“已确认可复用记忆”章节，包含模板、偏好、规则、事实。
- `tests/context.test.ts`
  - 覆盖 approved 模板进入上下文。
  - 覆盖 proposed 模板不会进入上下文。
- `scripts/memory-event-smoke.mjs`
  - 覆盖 `ic mem approve 1` 后，approved 模板进入后续 context。

**验收：**
- `npm run build` ✓
- `npm run test -- tests/context.test.ts` ✓
- `npm run smoke:memory` ✓

**下一步：**
- S4.4 Agent Action Audit Log 与 dev1 并行；dev2 可继续做全局模板确认策略，确保跨项目记忆必须显式确认。

### S4.4 Agent Action Audit Log（2026-05-13）

**目标：** 建立统一 Agent 动作审计日志，记录任务执行过程中的关键动作，保证可追溯、可脱敏、可在报告中引用。

**已实现：**

- `src/types.ts` 新增类型：
  - `AuditEvent` / `AuditActor` / `AuditAction` / `AuditResult`
- `src/core/audit.ts` 新增核心模块：
  - `appendAuditEvent(rootPath, actor, action, target, result, options?)`
  - `loadAuditEvents(rootPath, options?)` — 支持 taskId/action/limit 过滤
  - `sanitizeAuditPayload()` — 脱敏 API Key / token / password / secret
- 审计日志落盘：`.icloser/audit/events.jsonl`
- `executeTask()` 中记录 6 类关键动作：
  - `task-started` / `ai-called` / `file-written` / `verify-run` / `report-generated` / `memory-updated`
- `ic t` 命令中记录 `task-created`
- CLI 只读查看：
  - `ic audit` — 最近 20 条
  - `ic audit --task <id>` — 按任务过滤
  - 显示时间、actor、action、target、result
- 报告集成：
  - task report 新增“审计日志”章节
  - 显示本 task 相关审计事件数和列表
  - 提示 `ic audit` 查看完整日志
- 测试覆盖：
  - `tests/audit.test.ts` — 7 个测试，覆盖写入 JSONL、读取过滤、脱敏、嵌套对象、空日志
- `smoke:memory` 扩展审计验收：
  - 验证至少 5 条审计事件
  - 覆盖 task-created / file-written / verify-run / report-generated / memory-updated
  - API Key 不落盘

**验收：**
- `npm run build` ✓
- `npm run test` ✓
- `npm run smoke:memory` ✓
- `npm run smoke:all` ✓
- 不在 `src/core/context.ts` 中修改记忆检索逻辑

**相关文档：**
- `doc/tasks/2026-05-13-s4-agent-os-human-collab-memory.md`

### S4.1 Memory Metadata and User Input Event Stream（2026-05-13）

**目标：** 将“所有用户输入都是记忆系统一等数据源”落到代码里，先建立可追溯、可脱敏、可兼容旧数据的底层事件流。

**已实现：**
- `src/types.ts`
  - 新增 `MemoryMetadata`、`MemoryEvidence`、`UserInputMemoryEvent`。
  - 新增 `MemoryScope`、`MemorySource`、`MemoryReviewStatus`、`MemoryRiskLevel`、`UserInputKind`。
  - `ProjectMemory` 增加 `inputEvents`。
- `src/core/memory.ts`
  - 新增 `recordUserInputEvent()`：写入 `.icloser/input-events.jsonl`，并同步保留最近事件到 `.icloser/memory.json`。
  - 新增 `loadUserInputEvents()`。
  - 新增 `sanitizeUserInput()`：API Key、token、secret、password 等敏感输入落盘前脱敏。
  - `loadProjectMemory()` 兼容旧 memory 文件，缺少 `inputEvents` 时自动补空数组。
- `src/cli/repl.ts`
  - REPL 每条非空用户输入都会记录到短期记忆事件流。
  - `/apikey` 隐藏输入的真实 Key 只记录脱敏版本。
- `src/index.ts`
  - `ic t "任务描述"` 会记录为 `task-description`，并关联 taskId。
  - `ic rule "<约束>"` 会记录为 `rule`。
- `tests/memory.test.ts`
  - 覆盖用户输入事件写入、API Key 脱敏、旧 memory 兼容、secret assignment 脱敏。

**验收：**
- `npm run build` ✓
- `npm run test` ✓（15 files / 148 tests）
- `npm run smoke:repl` ✓（15 passed）
- `npm run smoke:repl:e2e` ✓（21 passed）

**下一步：**
- S4.2 做自动压缩、去重、风险评级和零知识用户的低负担确认。

### S4.1.2 REPL Current Directory Context Bugfix（2026-05-13）

**问题：** 用户在 REPL 输入“分析代码质量，整个目录”后，AI 回复“无法访问文件系统/请提供文件内容”。这与 Agent Shell 运行在当前项目目录、应自动理解项目的产品承诺冲突。

**修复：**
- `src/cli/repl.ts`
  - REPL 普通聊天从轻量 `state.projectIndex` 改为调用核心 `assembleContextFromProject()`。
  - 缺少 `.icloser/index.json` 时自动扫描并保存索引。
  - 成功加载索引后同步更新 REPL 内存状态。
  - system prompt 明确注入当前工作目录，并禁止回答“我无法访问文件系统/当前路径”。
  - 对“整个目录 / 当前目录 / 代码质量 / 项目结构”类请求追加整体分析指令。
  - scanner 失败时提供目录文件列表 fallback，而不是让模型空上下文胡说。
- `src/ai/provider.ts`
  - mock provider 对只读分析类请求返回分析摘要，不再伪造写入文件。
- `src/index.ts`
  - 修复 dev1 引入的 `memory events` 与 `mem|memory` command 重名导致 CLI 启动崩溃的问题；改为 `ic mem events`。
- `tests/provider.test.ts`
  - 增加 mock provider 只读分析回归测试。

**验收：**
- `npm run build` ✓
- `npm run test` ✓（15 files / 149 tests）
- `npm run smoke:repl:e2e` ✓（21 passed）

## 十三、开发特别声明

dev1、dev2 以及后续开发者必须遵守 [开发特别声明](DEVELOPER_SPECIAL_DECLARATION.md)。

核心要求：

- 用户可以完全不懂工程细节，Agent Shell 必须替用户判断、执行和汇报结果。
- 能本地完成的动作不能只给建议，例如“启动项目”必须进入执行流。
- 不能把所有请求硬接本地命令；应采用“语义意图路由 + 本地工具 + 大模型计划 + 记忆偏好”的混合方案。
- 低风险高置信动作可直接执行；中风险动作给中文数字选择；高风险动作必须明确确认。
- UI 必须中文、可选择、结果明确，文件路径和服务地址必须直接展示。

### S5.1 Semantic Intent Router and Chinese REPL UX（2026-05-13）

**目标：** 修正“用户说启动项目，系统只建议命令或继续闲聊”的问题，并把后续本地动作纳入语义意图路由原则。

**已完成：**

- `src/cli/repl.ts`
  - 新增 `/start` / `/serve`。
  - 用户输入“启动项目 / 运行项目 / 跑起来”等自然语言时，进入本地启动流程，不触发 AI 闲聊。
  - 启动流程读取 `package.json`，选择 `dev` / `start` / `serve` / `preview`。
  - 缺少 `node_modules` 且存在依赖时，自动先执行安装。
  - 捕获 `http://localhost:<port>` 并展示访问地址。
  - REPL 退出时清理后台启动的进程树。
  - 写入、撤销、提交确认选项改为中文。
- `src/cli/theme.ts`
  - `/help` 命令列表中文化，加入 `/start`。
- `scripts/repl-first-run-smoke.mjs`
  - 覆盖“启动项目”自然语言路径：必须执行 dev 脚本、捕获 URL、不出现“思考中”。
- `doc/DEVELOPER_SPECIAL_DECLARATION.md`
  - 新增 dev1/dev2 开发特别声明，明确零知识用户、聪明 Agent、语义意图路由和中文 UI 红线。

**验收：**

- `npm run build` 通过
- `npm run test` 通过，16 files / 164 tests
- `npm run smoke:repl` 通过，24/24
- `npm run smoke:repl:e2e` 通过，23/23
- `npm run smoke:all` 通过

**后续要求：**

- 当前“启动项目”是高置信本地意图的第一版实现。后续应抽象 `IntentRouter`，把本地规则、大模型语义计划和记忆偏好统一到一个可测试模块。
- 任何新增本地动作都必须遵守：低风险直接执行，中风险数字确认，高风险明确授权。

### S5.2 Verified File Write Receipt（2026-05-13）

**问题：** 用户看到 REPL 显示“写入成功”和绝对路径，但在文件管理器中没有找到文件。即使文件实际存在，系统也不能只假设写入成功；回执必须经过磁盘验证。

**已完成：**

- `src/cli/repl.ts`
  - 写入文件后立即执行 `stat()`。
  - 只有确认 `stat.isFile()` 后才计入成功写入。
  - 写入回执新增“已确认存在”和文件大小。
  - “刚才写到哪里了？”会重新检查磁盘；如果文件被移动或删除，会显示“未找到”和绝对路径。
- `doc/DEVELOPER_SPECIAL_DECLARATION.md`
  - 将“写入成功必须经磁盘验证”加入开发红线。

**验收：**

- `npm run build` 通过
- `npm run smoke:repl:e2e` 通过，23/23

### S5.3 System Operation Choice Panel（2026-05-13）

**目标：** 把“输入框和系统权限操作”从用户输入命令改为用户选择。系统负责整理操作，用户只按数字确认。

**已完成：**

- `src/cli/repl.ts`
  - 新增 `PendingSystemOperation`。
  - `pendingConfirm` 增加 `system` 状态。
  - “启动项目”不再直接执行系统命令，而是展示“需要你确认”面板。
  - 面板包含：操作、目录、原因、影响、将执行命令。
  - 用户输入 `1` 后执行一次；输入 `2` 取消。
- `scripts/repl-first-run-smoke.mjs`
  - 覆盖自然语言“启动项目”先展示系统操作确认面板。
  - 覆盖用户选择 `1` 后才执行 `npm run dev` 并捕获 URL。
- 文档
  - `doc/iCloser_Agent_Shell_完整需求文档.md` 增加“输入框与系统权限操作”。
  - `doc/ARCHITECTURE.md` 增加“选择优先”关键设计决策。
  - `doc/DEVELOPER_SPECIAL_DECLARATION.md` 增加系统权限操作确认红线。

**验收标准：**

- 用户输入“启动项目”后，看到中文确认面板，不需要自己输入命令。
- 用户选 `1` 才执行。
- 用户选 `2` 明确取消。
- 面板中能看到要执行什么、为什么执行、影响是什么。

### DEV2-S5.4 dev1 有条件验收修补（2026-05-13）

**来源：** dev1 验收结论为“有条件通过”，需要 dev2 收口 4 项问题。后续 dev2 的处理项统一使用 `DEV2-Sx.y-n` 编号，便于和 dev1 协调。

**已完成：**

- `DEV2-S5.4-1` 清理 `src/config.ts` 末尾残留 mock edit 注释。
- `DEV2-S5.4-2` 修复安全扫描器对 `dangerousCommands` 配置数组的误报；配置数组里的危险命令样例用于规则定义，不按待执行命令告警。
- `DEV2-S5.4-3` 增加根项目 `npm run lint`，使用无额外依赖的 `scripts/check-lint.mjs` 拦截冲突标记和真实残留注释。
- `DEV2-S5.4-4` 完成欢迎页 `Powered by <provider> / <model>` 展示。

**验收：**

- `npm run lint`
- `npm run build`
- `npm run test -- security`
- `npm run test`
- `npm run smoke:all`

### DEV2-S5.5 PowerShell-style System Approval（2026-05-13）

**问题：** S5.3 把系统操作做成了 iCloser 自己的“下一步选择框”，但产品目标是 PowerShell/Claude Code 风格的命令审批：用户看到要执行的命令、原因和影响，然后选择 Yes / Don't ask again / No。

**已完成：**

- `src/cli/repl.ts`
  - 系统操作确认面板改为 `PowerShell command` / `Shell command` 审批结构。
  - 启动项目时展示完整命令、中文原因、中文影响、当前目录。
  - 数字选择改为：
    - `1. Yes`：本次执行。
    - `2. Yes, and don't ask again for: ...`：本次会话记住同类操作并执行。
    - `3. No`：取消。
- `scripts/repl-first-run-smoke.mjs`
  - 验收自然语言“启动项目”必须出现命令审批面板，而不是普通 iCloser 菜单。
- `doc/iCloser_Agent_Shell_完整需求文档.md`
  - 修正“输入框与系统权限操作”的标准样例。

**验收标准：**

- 用户输入“启动项目”后看到 `PowerShell command` 或 `Shell command`。
- 面板包含 `This command requires approval` 和 `Do you want to proceed?`。
- 用户只需输入数字，不需要自己输入命令。
- 选择 `1` 后执行；选择 `2` 后本会话同类命令不再询问；选择 `3` 后取消。

### DEV2-S5.6 local-tools Skill 交叉验收与修补（2026-05-13）

**来源：** dev1 新增“本地开发工具管家” skill，并完成第一轮执行。dev2 负责交叉验收和阻塞项修补。

**验收结论：有条件通过，已修补阻塞项。**

**dev1 已完成：**

- 新增 `skills/local-tools/manifest.json`。
- 新增 `skills/local-tools/system-prompt.md`。
- 在 `src/skill/manager.ts` 注册 `local-tools` 内置 skill。
- 安装 `eslint` 与 `@typescript-eslint/*`。
- 新增 `eslint.config.mjs`。
- 将 `scripts/check-lint.mjs` 接入 ESLint。

**dev2 修补：**

- `scripts/check-lint.mjs`
  - 修复 Windows 下 `npx.cmd` 调用导致的静默失败。
  - 改为 Windows 使用 `cmd.exe /d /s /c npx.cmd eslint src/ tests/`。
  - ESLint 仅 warning 时不阻塞发布，输出 `eslint ok (<n> warnings)`。
- `tests/skill-manager.test.ts`
  - 覆盖 `local-tools` 作为 enabled builtin skill 被注册。
  - 覆盖“安装 eslint / 配置 lint 工具”能匹配到 `local-tools`。

**当前风险：**

- ESLint 目前还有既有 `no-unused-vars` warning，暂不作为发布阻塞；后续应单独安排清理。
- `skills/local-tools/` 文件与 `src/skill/manager.ts` 内置注册存在双份定义，后续应统一加载来源，避免描述漂移。

**验收：**

- `npm run lint`
- `npm run build`
- `npm run test -- skill-manager`
- `npm run test`
- `npm run smoke:all`

### DEV2-S5.8 System Operation Approval Core（2026-05-13）

**目标：** 把系统操作审批从 `src/cli/repl.ts` 中抽出第一层核心，避免后续“启动项目、安装依赖、运行测试、打开服务”等操作各自散落实现。

**已完成：**

- 新增 `src/cli/system-approval.ts`
  - `SystemOperation` / `SystemOperationStep` 统一描述系统操作。
  - `createStartProjectOperation()` 生成启动项目操作步骤。
  - `renderSystemOperationApproval()` 统一 PowerShell/Shell 风格审批面板。
  - `detectPackageManager()` / `packageManagerCommand()` 统一 npm/pnpm/yarn 跨平台命令生成。
- 更新 `src/cli/repl.ts`
  - 移除本地 `PendingSystemOperation` 类型。
  - REPL 只负责保存 pending operation、接收数字选择、执行步骤。
  - 启动项目仍保留原有行为：需要审批、可记住同类操作、确认后启动后台服务。
- 新增 `tests/system-approval.test.ts`
  - 覆盖 Windows `PowerShell command` 面板。
  - 覆盖 macOS/Linux `Shell command` 面板。
  - 覆盖 install-first 命令链。
  - 覆盖包管理器 lockfile 检测。

**验收：**

- `npm run build`
- `npm run test -- system-approval`
- `npm run smoke:repl`
- `npm run test`
- `npm run smoke:all`

### DEV2-S5.9 REPL Session Project Isolation（2026-05-13）

**问题：** 用户在新的工作目录启动 `ic` 时，欢迎页仍显示旧项目名、旧语言和旧框架。根因是 `loadSession()` 从全局 `~/.icloser/session.json` 恢复 `projectName/language/framework`，覆盖了当前目录的重新识别结果。

**已完成：**

- `src/cli/repl.ts`
  - `saveSession()` 增加 `projectRoot`。
  - `loadSession()` 只有在 `session.projectRoot === process.cwd()` 时才恢复会话。
  - 不再从 session 恢复项目名、语言、框架，启动项目上下文永远以当前工作目录检测结果为准。
- `scripts/repl-first-run-smoke.mjs`
  - 启动前故意写入一个旧项目 `iCloser2026/react` 的 session。
  - 验证新项目启动时不会显示“已恢复上次会话”。
  - 验证不会显示旧项目名 `iCloser2026`。

**验收：**

- `npm run build`
- `npm run smoke:repl`，31 passed
- `npm run test`
- `npm run lint`
- `npm run smoke:all`


### DEV2-S5.10 System Runner Core（2026-05-13）

**目标：** 把 REPL 里的命令执行能力抽出为可复用核心，让“启动项目、安装依赖、运行本地服务、捕获 URL、退出时停止后台进程”不再散落在交互层里。

**已完成：**

- 新增 `src/cli/system-runner.ts`
  - `runForegroundCommand()` 统一前台命令执行。
  - `startBackgroundCommand()` 统一后台服务启动和本地 URL 捕获。
  - `stopStartedProcess()` 统一退出时的后台进程清理。
  - `extractLocalUrl()` / `formatCommandChunk()` 提供可测试的纯函数。
- 更新 `src/cli/repl.ts`
  - REPL 只负责 UI 展示和用户选择。
  - 系统操作执行交给 `system-runner`。
  - 保留 PowerShell 风格审批面板和中文执行结果。
- 新增 `tests/system-runner.test.ts`
  - 覆盖 localhost / 127.0.0.1 / 0.0.0.0 / IPv6 URL 捕获。
  - 覆盖命令输出 ANSI 清理和行数限制。
  - 覆盖后台进程运行态判断。

**验收：**

- `npm run build`
- `npm run test -- system-runner`
- `npm run smoke:repl`
- `npm run test`
- `npm run smoke:all`


### DEV2-S5.11 Confirm Input Panel UX Fix（2026-05-13）

**问题：** 系统操作确认仍像普通聊天输入一样回显，用户输入 `1` 后会出现额外的 `◇ 1`，并且面板中英文混杂，不符合“用户只看中文选项并确认”的产品要求。

**已完成：**

- `src/cli/system-approval.ts`
  - 系统权限面板改为中文。
  - 明确展示命令、目录、原因、影响和 1/2/3 三个选择。
  - 移除英文 `Do you want to proceed?` / `Yes` 文案。
- `src/cli/repl.ts`
  - 新增动态 prompt：系统确认态显示 `选择 1 允许 · 2 允许并记住 · 3 取消 >`。
  - 系统确认输入不再打印额外聊天回显。
  - 非 1/2/3 输入会在确认态内提示，不会落入 AI 对话。
- `tests/system-approval.test.ts` 和 `scripts/repl-first-run-smoke.mjs`
  - 同步更新中文确认面板断言。

**验收：**

- `npm run build`
- `npm run test -- system-approval`
- `npm run smoke:repl`


### DEV2-S5.12 Unified Choice Panel Core（2026-05-13）

**目标：** 把“系统权限确认”和“文件写入确认”的面板渲染、数字选择解析、输入框提示统一成一个底层模块，为后续真正底部 TUI 固定栏做准备。

**已完成：**

- 新增 `src/cli/choice-panel.ts`
  - `ChoicePanel` / `ChoiceOption` 描述通用选择面板。
  - `renderChoicePanel()` 统一中文面板渲染。
  - `parseChoiceInput()` 统一单选/多选数字解析。
  - `choicePrompt()` 统一确认态输入框提示。
- 更新 `src/cli/system-approval.ts`
  - 系统权限确认改用 `renderChoicePanel()`。
- 更新 `src/cli/repl.ts`
  - 增加 `activeChoicePanel` 状态。
  - 系统操作和文件写入确认共享统一 prompt 逻辑。
  - `parseBottomSelection()` 改为复用 `parseChoiceInput()`。
- 新增 `tests/choice-panel.test.ts`
  - 覆盖中文面板渲染、单选严格解析、多选解析。
- 更新 `scripts/repl-first-run-smoke.mjs`
  - 增加断言：确认系统操作后不会把 `1` 回显为聊天消息。

**验收：**

- `npm run build`
- `npm run test -- choice-panel system-approval repl-completer`
- `npm run smoke:repl`


### DEV2-S6.1 Project Autopilot Analyzer（2026-05-13）

**目标：** 开启大项目工程自动驾驶能力。第一阶段只做只读项目分析，输出项目画像、文档缺口、测试缺口和下一步动作，不直接改文件。

**已完成：**

- 新增 `src/core/autopilot.ts`
  - `analyzeProjectAutopilot()` 自动分析项目。
  - `renderAutopilotReport()` 输出中文项目分析报告。
  - 识别源码规模、测试文件、文档文件、npm scripts、缺失 docs。
  - 给出下一步动作：只分析、补齐文档、生成测试计划、规划低风险修复、取消。
- 更新 `src/index.ts`
  - 新增 `ic autopilot`。
  - 新增别名 `ic auto`。
  - 支持 `--json` 输出 `autopilot-report`。
- 新增 `tests/autopilot.test.ts`
  - 覆盖项目画像、缺失文档、下一步动作、中文渲染。
- 新增 `scripts/autopilot-smoke.mjs`
  - 覆盖 CLI JSON 输出可解析。
- 更新 `package.json`
  - 新增 `npm run smoke:autopilot`。
- 更新 `scripts/full-smoke.mjs`
  - `smoke:all` 纳入 Autopilot 冒烟。
- 新增 `doc/PROJECT_AUTOPILOT.md`
  - 记录产品路径和 S6 研发拆分。

**验收：**

- `npm run build`
- `npm run test -- autopilot`
- `npm run smoke:autopilot`
- `npm run test`
- `npm run lint`
- `npm run smoke:all`


### DEV2-S6.3 Auto Test Planner（2026-05-13）

**目标：** 让大项目自动驾驶具备“先判断测试缺口，再小步补测”的能力。当前阶段只生成测试计划，不直接写测试文件。

**已完成：**

- `src/core/autopilot.ts`
  - 新增 `planProjectTests()`。
  - 新增 `renderAutopilotTestPlan()`。
  - 按模块聚合源码文件和测试文件。
  - 判断模块测试状态：`missing` / `partial` / `covered`。
  - 输出优先级：`high` / `normal` / `low`。
  - 自动建议测试文件路径和验证命令。
- `src/index.ts`
  - `ic autopilot tests` / `ic auto tests` 输出中文测试规划。
  - `--json` 输出 `kind: autopilot-test-plan`。
- `tests/autopilot.test.ts`
  - 覆盖测试计划生成、缺口识别、中文渲染。
- `scripts/autopilot-smoke.mjs`
  - 覆盖 `autopilot --json` 和 `autopilot tests --json`。

**验收：**

- `npm run build`
- `npm run test -- autopilot`
- `npm run smoke:autopilot`
- `npm run test`
- `npm run lint`
- `npm run smoke:all`

### DEV2-S6.4 Autonomous Execution Chain（2026-05-13）

**目标：** 将“自动找问题、自动执行、自动验证、失败自动修复、必要时回滚、最终报告和记忆沉淀”固化为显式执行链，而不是依赖模型临场猜测。

**已完成：**

- 新增 `src/core/execution-chain.ts`
  - 定义 10 个阶段：理解目标、自动检查、生成计划、中文确认、执行变更、自动验证、失败修复、安全回滚、交付报告、记忆沉淀。
  - 定义风险策略：只读自动、写入确认、命令确认、回滚高风险确认。
  - 定义自动修复最多 2 次。
- 更新 `src/index.ts`
  - 新增 `ic autopilot chain` / `ic auto chain`。
  - `--json` 输出 `kind: autonomous-execution-chain`。
- 修复 REPL 分析后确认态残留
  - 新消息会清理旧的待写入选择。
  - 只有明确写入/修改/生成/修复任务，或 AI 输出标准写入契约，才进入文件确认面板。
- 新增 `tests/execution-chain.test.ts`。
- 扩展 `tests/repl-completer.test.ts` 写入意图识别测试。
- 扩展 `scripts/autopilot-smoke.mjs` 覆盖 execution chain JSON。
- 新增 `doc/AUTONOMOUS_EXECUTION_CHAIN.md`。

**验收：**

- `npm run build`
- `npm run test -- execution-chain repl-completer`
- `npm run smoke:autopilot`
- `npm run test`
- `npm run smoke:all`

### DEV2-S6.5 Safe Documentation Writer Receipt（2026-05-13）

**目标：** 验收并补强 `ic auto docs`，使自动文档写入符合“零知识用户 + 中文确认 + 写入后磁盘验证 + JSON 可脚本消费”的产品要求。

**已完成：**

- `src/core/autodoc.ts`
  - `writeDocs()` 返回 `DocWriteReceipt`。
  - 每个写入文档包含 `fullPath`、`verified`、`bytes`、`lines`。
  - 写入后立即检查磁盘，避免“显示写入成功但文件找不到”。
- `src/index.ts`
  - `ic auto docs --json` 输出计划，不写入。
  - `ic auto docs --go --json` 执行写入并输出 `autopilot-docs-written`。
  - `--yes` 文案改为必须和 `--go` 搭配，用于覆盖已有文档。
  - 普通 CLI 写入回执显示绝对路径和“磁盘确认”。
- `tests/autodoc.test.ts`
  - 覆盖写入后磁盘验证回执。
- `scripts/autopilot-smoke.mjs`
  - 覆盖 docs 计划 JSON。
  - 覆盖 docs 写入 JSON。
  - 验证 `docs/PRD.md` 真实存在。

**验收：**

- `npm run build`
- `npm run test -- autodoc`
- `npm run smoke:autopilot`
- `npm run test`
- `npm run smoke:all`

### DEV2-S6.6 Safe Test Writer（2026-05-13）

**目标：** 基于 `ic auto tests` 的测试计划，安全生成一个最高优先级模块的最小测试文件，写入后输出磁盘验证回执。

**已完成：**

- 新增 `src/core/autotest.ts`
  - `buildTestWritePlan()` 从测试计划中选择一个缺测试模块。
  - 默认一次只生成 1 个测试文件，避免大项目批量失控修改。
  - `writeTests()` 写入后返回 `fullPath`、`verified`、`bytes`、`lines`。
  - 支持 TypeScript/JavaScript starter test，预留 Go/Python/Java starter test。
- 更新 `src/index.ts`
  - `ic auto tests` 保持只读测试规划。
  - `ic auto tests --go` 写入一个最小测试文件。
  - `ic auto tests --go --json` 输出 `autopilot-tests-written`。
  - `--module <name>` 可指定补测模块。
  - `--yes` 可覆盖已有测试文件。
- 新增 `tests/autotest.test.ts`。
- 扩展 `scripts/autopilot-smoke.mjs`
  - 验证 `ic auto tests --go --json`。
  - 验证测试文件真实存在且 `verified=true`。

**验收：**

- `npm run build`
- `npm run test -- autotest autopilot`
- `npm run smoke:autopilot`
- `npm run test`
- `npm run smoke:all`

### DEV2-S6.7 Verify After Autopilot Write（2026-05-13）

**目标：** Autopilot 写入文档或测试后，立即给出验证结果，不只停留在“文件已写入”。

**已完成：**

- 新增 `src/core/autopilot-verify.ts`
  - `verifyAutopilotDocs()`：校验写入文档存在、非空、包含一级标题。
  - `verifyAutopilotTests()`：依赖可用时运行测试命令；依赖未安装时明确 `skipped`，给出 `npm install` 新手提示。
  - `formatAutopilotVerification()`：中文验证摘要。
- 更新 `src/index.ts`
  - `ic auto docs --go --json` 输出 `verification`。
  - `ic auto tests --go --json` 输出 `verification`。
  - 普通输出增加验证结论。
- 新增 `tests/autopilot-verify.test.ts`。
- 扩展 `scripts/autopilot-smoke.mjs`
  - 文档写入必须 `verification.status=pass`。
  - 测试写入必须包含 `verification.status=pass|skipped`。

**验收：**

- `npm run build`
- `npm run test -- autopilot-verify autotest autodoc`
- `npm run smoke:autopilot`
- `npm run test`
- `npm run smoke:all`
## 十四、常见开发任务

### 修复一个模块 Bug

1. 定位到对应 `src/*/` 下的文件
2. 修改代码
3. 运行 `npm run typecheck` 确保类型正确
4. 运行 `npm run build` 确保编译通过
5. 在实际项目中测试：`cd test-project && iCloser init && iCloser t "测试任务"`

### 添加新功能

1. 在 `src/types.ts` 中添加所需类型
2. 在对应模块中实现核心逻辑
3. 如果涉及 CLI，在 `src/index.ts` 或 `src/cli/repl.ts` 中添加命令
4. 更新 `doc/ARCHITECTURE.md` 的模块说明
5. 在 `doc/tasks/` 中创建任务记录文件（格式：`YYYY-MM-DD-简短描述.md`）

### 语言扩展（支持新语言）

1. 在 `types.ts` 的 `LanguageType` 中添加
2. 在 `src/utils/detect.ts` 中添加检测逻辑
3. 在 `src/core/verifier.ts` 中添加编译/测试命令
4. 在 `src/core/scanner.ts` 中添加源文件模式
5. 在 `src/index.ts` 的 `getSourcePatterns()` 中添加 glob











## DEV2-S6.8 Natural Language Autopilot Router（2026-05-13）

目标：让完全不会命令的新用户在 REPL 里直接输入中文，例如“分析整个项目”“补齐文档”“检查测试缺口”“帮我自动补单测”，系统自动接入本地 autopilot 工程链路。

完成：
- 新增 `src/core/autopilot-router.ts`：中文自然语言意图路由，覆盖项目分析、补文档、测试规划、写测试、自动执行链。
- REPL 在调用大模型前优先识别高置信本地工程意图，避免 AI 瞎说“我无法访问文件系统”。
- 写入类动作统一走底部中文选择面板：用户只输入数字，确认后写入、校验、展示真实路径和磁盘回执。
- 新增 `tests/autopilot-router.test.ts`，保证路由规则可回归。

验收标准：
- `分析整个项目`：直接输出本地项目工程分析，不调用 AI。
- `补齐文档`：展示确认面板，选择 1 后写入 docs 缺失文件并校验。
- `检查测试缺口`：直接输出测试规划，不写文件。
- `帮我自动补单测`：展示确认面板，选择 1 后写入一个最小测试并自动验证。

## DEV2-S6.9 Verify Failure Rollback Loop（2026-05-13）

目标：补齐 autopilot 写入后的失败处理闭环，验证失败时不把问题抛给新手用户，而是给出中文选择：回滚本次写入、保留变更继续修复、查看回滚方案。

完成：
- 新增 `src/core/autopilot-rollback.ts`：写入前快照、回滚计划、回滚执行、中文渲染。
- REPL autopilot 文档/测试写入前创建快照；验证失败后展示底部选择面板。
- 回滚只处理本轮 autopilot 快照文件：原本不存在则删除，原本存在则恢复内容。
- 新增 `tests/autopilot-rollback.test.ts` 覆盖新建文件删除、已有文件恢复、中文方案渲染。

验收标准：
- 自动文档/测试写入验证通过时不弹回滚。
- 验证失败时展示“回滚本次写入 / 保留变更 / 查看回滚方案”。
- 选择回滚只影响本轮写入文件，不触碰其它用户文件。

## DEV2-S6.10 Auto Repair Planner（2026-05-13）

目标：验证失败后不直接把用户推到回滚，而是先生成自动修复诊断，让零基础用户看到清晰下一步选择。

完成：
- 新增 `src/core/autopilot-repair.ts`：根据文档/测试验证失败摘要生成修复计划。
- REPL autopilot 写入验证失败后展示“查看修复建议 / 回滚本次写入 / 保留变更”。
- 修复计划只做诊断和建议，不自动扩大修改范围；后续 S6.11 再做受控自动改写。
- 新增 `tests/autopilot-repair.test.ts` 覆盖文档标题缺失和测试 import 失败场景。

验收标准：
- 文档验证失败时能给出标题/内容/路径修复建议。
- 测试验证失败时能给出 import/语法/类型/测试命名修复建议。
- 用户仍可一键回滚本轮 autopilot 写入。

## DEV2-S6.11 Controlled Auto Repair（2026-05-14）

目标：在验证失败后允许系统进行一次受控自动修复，修复范围必须限制在本轮 autopilot 写入文件内，修完自动复验。

完成：
- `src/core/autopilot-repair.ts` 新增 `applyAutopilotRepairPlan()` 与修复回执渲染。
- 文档类高确定性失败（空文档、缺一级标题）可自动最小修复。
- 测试类失败继续只给诊断建议，避免缺少上下文时乱改 import。
- REPL 失败处理面板升级为“自动修复一次 / 回滚本次写入 / 保留变更”。
- 自动修复后立即运行文档校验或测试校验；仍失败则回到选择面板。

验收标准：
- 自动修复只能处理本轮写入文件，拒绝项目目录外路径。
- 文档缺标题可自动补标题并复验通过。
- 无法安全自动修复的失败类型只输出建议，不写文件。

## DEV2-S6.12 Repair Smoke Gate（2026-05-14）

目标：把“自动执行失败 → 自动修复 → 复验”的关键链路加入发布级验收，避免只在单测里通过、真实用户路径断掉。

完成：
- 新增 `scripts/autopilot-repair-smoke.mjs`。
- 新增 `npm run smoke:repair`。
- `smoke:repair` 覆盖：
  - 文档缺少一级标题时生成高可信修复计划，自动补标题，复验通过。
  - 测试文件语法缺失闭合括号时自动最小修复。
  - `../outside.md` 这类越界路径被拒绝。
- `npm run smoke:all` 已纳入 repair gate。

验收：
- `npm run smoke:repair` 通过。

## DEV2-S6.13 Task Thinking Loop（2026-05-14）

目标：把用户提出的“收集上下文 → 采取行动 → 验证结果”变成项目核心机制，并明确模型与工具分工。

完成：
- 新增 `src/core/task-loop.ts`，定义三步循环、状态推进、用户中断、最大轮次策略。
- 新增 `tests/task-loop.test.ts`，覆盖循环顺序、失败回环、通过完成、最大轮次停止、用户打断。
- `ic auto chain --json` 输出新增 `taskLoop`，文本输出新增三步循环说明。
- 新增 `doc/TASK_THINKING_LOOP.md`。
- 更新 `doc/AUTONOMOUS_EXECUTION_CHAIN.md` 与完整需求文档。

验收：
- `npm run test -- task-loop execution-chain` 通过，8 tests passed。

## DEV2-S6.14 User Flow Diagram Integration（2026-05-14）

目标：把用户提供的流程图补进三步任务循环机制，确保产品图、状态机和测试一致。

完成：
- `src/core/task-loop.ts` 新增用户干预语义：`add-context`、`change-direction`、`interrupt-task`。
- 新增验证后分支语义：`complete`、`continue-loop`、`ask-user`。
- 用户干预可在任意阶段触发：补充信息/调整方向回到收集上下文，中断任务停止循环。
- `tests/task-loop.test.ts` 增加流程图分支测试。
- `doc/TASK_THINKING_LOOP.md` 增加产品流程图逻辑。
- `doc/AUTONOMOUS_EXECUTION_CHAIN.md` 同步流程分支说明。

验收：
- `npm run test -- task-loop` 通过，6 tests passed。

## DEV2-S6.15 Loop Tool Matrix（2026-05-14）

目标：把用户提出的五大类工具和三步任务循环合并为统一机制，而不是孤立能力清单。

完成：
- `src/core/task-loop.ts` 新增 `TaskLoopToolCategory` 和五类工具：文件操作、搜索、执行命令、网络搜索、代码智能。
- 每个循环步骤新增 `requiredToolCategories`：
  - 收集上下文：文件操作 / 搜索 / 网络搜索 / 代码智能
  - 采取行动：文件操作 / 搜索 / 执行命令
  - 验证结果：文件操作 / 搜索 / 执行命令 / 代码智能
- 每类工具定义 availability、safetyRule、fallback，明确缺插件或网络不可用时如何降级。
- `renderTaskThinkingLoop()` 展示“五大工具能力”和“循环 × 工具矩阵”。
- `tests/task-loop.test.ts` 新增五大工具矩阵验收。
- `doc/TASK_THINKING_LOOP.md` 和 `doc/ARCHITECTURE.md` 同步更新。

验收：
- `npm run test -- task-loop` 通过，7 tests passed。

## S7 Loop Tool Integration Plan（2026-05-14）

目标：把 S6 已定义的“三步循环 × 五大工具”接入下一轮真实研发任务。

拆分：
- S7.1 dev2：Tool Capability Registry，建立五大工具运行时能力快照。
- S7.2 dev1：REPL Loop Status Panel，让用户看到当前处于收集上下文/执行操作/验证结果。
- S7.3 dev2：Task Main Chain Loop Hook，把循环接入 `ic t` 主链。
- S7.4 dev1：Tool Fallback Messages，补网络搜索/代码智能/命令不可用时的新手中文提示。
- S7.5 dev2：End-to-End Loop Smoke，把 loop gate 纳入发布验收。

详细文档：`doc/tasks/2026-05-14-s7-loop-tool-integration-plan.md`。

## DEV2-S7.1 Tool Capability Registry（2026-05-14）

目标：把三步循环依赖的五大工具能力做成运行时注册表，让系统能知道工具是否可用、缺失时如何降级。

完成：
- 新增 `src/core/tool-registry.ts`。
- 新增 `tests/tool-registry.test.ts`。
- 支持五类工具能力状态：文件操作、搜索、执行命令、网络搜索、代码智能。
- 支持按循环步骤查询工具能力：`collect-context`、`take-action`、`verify-result`。
- 网络搜索默认 `limited`，降级为本地文档、依赖源码和记忆。
- 代码智能默认 `limited`，降级为正则搜索、项目扫描和编译/类型检查错误分析。
- 命令能力可通过选项标记为 unavailable，避免系统假装命令已执行。
- 提供中文渲染：`renderStepToolStatus()` 与 `renderToolFallbackSummary()`。

验收：
- `npm run test -- tool-registry task-loop` 通过，12 tests passed。

## DEV2-S7.2 REPL Loop Status Panel（2026-05-14）

目标：把三步循环状态接入 REPL，让用户输入自然语言后能看到系统当前正在“收集上下文 / 执行操作 / 验证结果”，以及正在使用哪些工具、哪些能力已降级。

完成：
- 新增 `src/cli/loop-panel.ts`。
- 新增 `tests/loop-panel.test.ts`。
- REPL 自然语言本地工程意图先显示“收集上下文”面板。
- “分析整个项目”展示：步骤 1/3 收集上下文，工具包含文件操作/搜索/网络搜索(降级)/代码智能(降级)。
- “启动项目”展示：先收集上下文，再进入步骤 2/3 执行操作，然后显示系统权限确认面板。
- 文档/测试自动写入路径在写入前显示执行操作，校验前显示验证结果。
- 用户输入“换个方法试试 / 先不要执行 / 暂停任务”等会作为用户干预，回到收集上下文，不进入普通 AI 聊天。
- `scripts/repl-first-run-smoke.mjs` 增加 loop panel 断言，REPL smoke 从 38 项提升到 43 项断言。

验收：
- `npm run build` 通过。
- `npm run lint` 通过（42 个既有 eslint warnings）。
- `npm run test -- loop-panel tool-registry repl-completer choice-panel` 通过，26 tests passed。
- `npm run smoke:repl` 通过，43 passed。

## S8 AST Parser — TypeScript/JavaScript（2026-05-14，dev1）

目标：用 tree-sitter 实现 TS/JS 代码的 AST 解析，提取函数、类、接口、导出、导入、调用图。

完成：
- 新增 `src/core/ast-parser.ts`（tree-sitter + tree-sitter-typescript）
- 新增 `tests/ast-parser.test.ts`（24 项 TS/JS 测试）
- scanner.ts 集成：extractExportsSmart / extractImportsSmart 走 AST
- types.ts 新增 AST-enhanced 字段：ExportInfo(parameters, returnType, isDefault)、ImportInfo(defaultImport, namespaceImport, isTypeOnly)

验收：`npm run test -- ast-parser scanner` 通过，build 通过。

## S9 Agent Manager + 多语言 AST（2026-05-14，dev1+dev3）

### S9 dev1：Agent Manager

目标：实现多 Agent 编排引擎。

完成：
- 新增 `src/agent/manager.ts`：AgentManager 类
  - create/start/pause/resume/stop — 完整生命周期
  - sendMessage/getMessages/broadcast — 消息总线
  - writeContext/readContext/clearContext — 共享上下文
  - createChildren/getTree — 层级树
  - maxConcurrent 并发控制
- 新增 `tests/agent-manager.test.ts`（14 项）
- types.ts 新增 AgentType/AgentStatus/AgentInstance/AgentMessage 类型
- REPL 集成：`/run` `/agents` 命令

验收：`npm run test -- agent-manager` 14 tests passed。

### S9 dev3：多语言 AST 解析

目标：扩展 AST 解析器支持 Go/Python/Java/Kotlin/Swift/ObjC/SQL。

完成：
- ast-parser.ts 新增 8 种语言解析器（tree-sitter + 正则混合）
- scanner.ts AST_FILE_EXTS 扩展到 23 种扩展名
- 新增 `tests/ast-parser.test.ts` Go/Python/Java/Kotlin/Swift/ObjC/SQL 测试（+21 项）
- scanner 多语言扫描测试

验收：`npm run test -- ast-parser scanner` 45+ tests passed。

## S10 网络搜索（2026-05-14，dev3）

目标：实现零配置网络搜索，消除"网络搜索暂不可用"降级提示。

完成：
- 新增 `src/core/web-search.ts`：DuckDuckGo API 搜索，24h 缓存，自动降级
- context.ts 新增 externalKnowledge 字段 + 技术关键词提取
- tool-registry.ts：web-search 默认 available
- 更新 output-fallback / loop-panel / tool-registry 测试

验收：`npm run smoke:web-search` 通过。REPL 不再显示"1项降级"。

## S11 跨文件调用图 + 增量扫描（2026-05-14，dev3）

目标：构建项目级函数调用图，支持增量扫描跳过未变文件。

完成：
- scanner.ts：buildCrossFileCallGraph + computeFingerprints + loadPreviousFingerprints
- types.ts：CrossFileCallEdge / fileFingerprints 类型
- scanProject 集成了增量扫描（fingerprints 跳过 80% 以上未变文件）
- 新增 `tests/scanner-s10.test.ts`（6 项）

验收：`npm run test -- scanner-s10` 通过。

## S12 Agent CLI + Smoke（2026-05-14，dev3）

目标：把 AgentManager 接入 CLI 和 REPL，补 web-search/agent smoke。

完成：
- index.ts：`ic agent create/start/stop/list/status/children/message` 命令（--json 支持）
- repl.ts：`/agent create/stop/status` 命令 + `isCliCommandInRepl` 检测
- 新增 `scripts/web-search-smoke.mjs` + `scripts/agent-smoke.mjs`
- full-smoke.mjs 接入 web-search + agent smoke

验收：`npm run smoke:agent` `npm run smoke:web-search` 通过。

## S13 Task → Agent 桥接（2026-05-14，dev3）

目标：`ic t "任务" --go` 执行时自动创建 Agent 并记录执行结果。

完成：
- index.ts executeTask：AI 调用后创建 Agent，记录 _agentResult/_agentId
- Agent 结果可供后续报告使用

验收：`ic t "test" --go` 成功，Agent 自动创建。

## S14 Agent 安全沙箱（2026-05-14，dev3）

目标：Agent 的 sandboxLevel 字段实际生效。

完成：
- agent/manager.ts：checkSandboxWrite / filterSandboxedFiles
- readonly：禁止所有文件写入
- isolated：禁止访问项目根目录外的路径
- index.ts executeTask：文件写入前调用沙箱检查
- 新增 `tests/agent-sandbox.test.ts`（8 项）

验收：`npm run test -- agent-sandbox` 通过。

## S15 Agent → Report 整合（2026-05-14，dev3）

目标：Agent 执行结果纳入任务报告。

完成：
- report/generator.ts：generateTaskReport 新增"Agent 执行"章节
- 显示 Agent ID、状态、Token 用量、耗时、产出

验收：`npm run test` 326 tests passed。

## S16 真实验收 + 文档（2026-05-14，dev3）

目标：完整端到端验证，文档补全。

完成：
- DEVELOPMENT.md 补 S8-S16 记录
- doc/PROJECT_STATUS.md 模块地图 + 一致性核对
- doc/tasks/ 补 S10/S12/S13-S16 计划文档
- 全量验收

验收：
```bash
npm run build         # 零错误
npm run test          # 326 passed / 37 files
npm run smoke:agent   # PASS
npm run smoke:web-search # PASS
npm run smoke:loop    # PASS
npm run smoke:multilang # PASS
```

## S17 多 Agent 编排（2026-05-14，dev1+dev3）

### S17.1 编排核心（dev1）

目标：AgentManager 支持 orchestrator 类型 Agent。

完成：
- agent/manager.ts：`orchestrate(description)` — 完整编排流程
  - 创建 orchestrator Agent → AI 拆解任务 → 解析子任务 → createChildren → 并行执行 → 汇总
- `waitForAgent(agentId, timeout)` — 轮询等待 Agent 完成
- `getTree(agentId)` — 递归获取 Agent 层级树（含 result 摘要和 children 递归）
- `buildAgentSystemPrompt(agent)` — 按 6 种 Agent 类型生成系统提示词
- `AGENT_TYPE_PRESETS` — 每种 Agent 的默认模型/工具/提示词配置

验收：`npm run test -- agent-manager` 14 tests passed。

### S17.2 集成（dev3）

- `ic agent orchestrate <描述>` CLI 命令
- REPL `/orchestrate <描述>` 命令
- Mock provider 识别编排提示词，返回结构化子任务列表

验收：`ic agent orchestrate "分析项目代码质量"` → 4 子 Agent 并行完成。

## S18 AI 工具调用（2026-05-14，dev3）

目标：AI 大脑能直接调用本地五层工具（read_file/search_code/run_command/web_search/code_intel）。

完成：
- 新增 `src/core/tool-executor.ts`：5 个工具定义 + 统一执行器
- executeTask 内建工具调用循环（最多 5 轮）：
  AI 思考 → 返回 tool_calls → 执行工具 → 注入结果 → AI 继续思考 → 最终输出
- 安全策略：read_file 禁止路径穿越、run_command 拦截危险命令

验收：
```bash
npm run build  # 零错误
npm run test   # 326 passed / 37 files
```
