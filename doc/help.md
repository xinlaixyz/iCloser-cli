# ic — iCloser Agent Shell CLI

## 简介

`ic` 是一个命令行 AI 工程助手。输入自然语言任务描述，AI 自动理解项目、修改代码、验证通过、生成报告。

## 安装

```bash
cd AgentCode
npm install
npm run build
npm link
```

## 设置 AI 服务

### API Key

```powershell
# PowerShell
$env:DEEPSEEK_API_KEY = "sk-xxx"
$env:ANTHROPIC_API_KEY = "sk-ant-xxx"
$env:OPENAI_API_KEY = "sk-xxx"
$env:DASHSCOPE_API_KEY = "sk-xxx"
```

```bash
# Bash / Zsh
export DEEPSEEK_API_KEY="sk-xxx"
export ANTHROPIC_API_KEY="sk-ant-xxx"
export OPENAI_API_KEY="sk-xxx"
export DASHSCOPE_API_KEY="sk-xxx"
```

### 切换 Provider

```bash
ic config provider deepseek     # DeepSeek（推荐性价比）
ic config provider claude       # Claude（推荐复杂任务）
ic config provider openai       # OpenAI
ic config provider qwen         # 通义千问

ic config model <model-name>    # 切换模型
```

## 工作流

### 日常使用

```bash
# 1. 进入项目，初始化
cd my-project
ic init

# 2. 创建任务（默认预览模式，先看方案再决定）
ic t "给用户模块增加手机号登录"

# 输出示例：
#   [·] 解析任务意图...
#       子目标：
#       1. User 模型增加 phone 字段
#       2. 新增 phoneLogin() 方法
#       3. 新增 /auth/phone/login 路由
#
#   [·] 生成修改方案 →
#   ✎ src/types/user.ts       — 新增 phone?: string
#   ✎ src/auth/login.ts       — 新增 phoneLogin() 方法
#   ✎ src/api/auth.ts         — 新增 POST /auth/phone/login
#
#   风险等级：低
#   是否确认此方案？[Y/n]

# 3. 确认执行
ic y <task-id>

# 4. 门禁检查
ic gate <task-id>

# 5. 查看报告
ic r
```

### 快速模式（跳过预览）

```bash
ic t "修复登录页样式问题" --go
```

### 并行任务

```bash
ic t "增加手机登录" "增加邮箱验证" "修复头像上传"
```

## 命令参考

### 核心工作流

| 命令 | 别名 | 说明 |
|------|------|------|
| `ic init` | — | 初始化项目，自动识别语言/框架/DB |
| `ic scan` | — | 重新扫描项目并更新索引 |
| `ic t "<描述>"` | `ic task` | 创建任务（默认预览模式） |
| `ic t "<描述>" --go` | — | 直接执行，跳过预览 |
| `ic y <id>` | `ic accept` | 确认应用修改 |
| `ic n <id>` | `ic reject` | 拒绝并回滚修改 |

### 任务管理

| 命令 | 别名 | 说明 |
|------|------|------|
| `ic st` | `ic status` | 任务队列一览 |
| `ic st <id>` | — | 某任务详细状态 |
| `ic st --json` | — | JSON 格式输出任务列表 |
| `ic st <id> --json` | — | JSON 格式输出单个任务 |
| `ic d <id>` | `ic diff` | 查看代码 diff |
| `ic cancel <id>` | — | 取消排队中的任务 |
| `ic rollback <id>` | — | 回滚任务到执行前状态 |

### 门禁与报告

| 命令 | 别名 | 说明 |
|------|------|------|
| `ic gate <id>` | `ic g` | 门禁检查（6 道门禁） |
| `ic gate <id> --json` | — | JSON 格式输出（CI 集成） |
| `ic gate <id> --skip-gate` | — | 跳过门禁（个人开发） |
| `ic log` | `ic l` | 任务历史列表 |
| `ic log <id>` | — | 某任务完整报告 |
| `ic r` | `ic report` | 最近一次任务报告 |
| `ic r --regenerate` | — | 强制重新生成报告 |

### 记忆系统

| 命令 | 说明 |
|------|------|
| `ic mem` | 查看当前项目记忆 |
| `ic mem global` | 查看跨项目全局记忆 |
| `ic mem global "所有项目使用 async/await"` | 写入全局记忆 |
| `ic mem <关键词>` | 搜索项目记忆 |
| `ic rule "<约束>"` | 写入架构约束 |
| `ic rule --list` | 列出所有约束 |
| `ic rule --delete <id>` | 删除约束 |

### 配置

| 命令 | 说明 |
|------|------|
| `ic doctor` | 检查当前项目是否已初始化、索引是否存在、Provider 是否可用 |
| `ic doctor --json` | JSON 格式输出项目就绪诊断 |
| `ic doctor --strict` | 未 ready 时返回非 0，适合 CI/脚本门禁 |
| `ic doctor --strict --json` | JSON 格式输出，同时在未 ready 时返回非 0 |
| `ic config` | 查看当前配置（含安全规则状态） |
| `ic config --json` | JSON 格式输出公开配置摘要，不包含 API Key |
| `ic config provider <name>` | 切换 AI Provider |
| `ic config model <name>` | 切换模型 |
| `ic config mode preview\|execute` | 切换默认执行模式 |
| `ic config security` | 查看安全配置摘要 |
| `ic config security rules` | 列出全部安全规则及启用/禁用状态 |
| `ic config security rules --json` | JSON 格式输出（CI/脚本消费） |
| `ic config security disable <ruleId>` | 禁用指定安全规则（校验 ruleId） |
| `ic config security enable <ruleId>` | 启用指定安全规则（校验 ruleId） |

### Provider 与模型

| 命令 | 说明 |
|------|------|
| `ic provider` / `ic provider list` | 查看可用 Provider、当前模型和 Key 状态 |
| `ic provider list --json` | JSON 格式输出 Provider 状态 |
| `ic provider use <name> [model]` | 切换 Provider，可选同时指定模型 |
| `ic provider models [name]` | 查看某个 Provider 的内置模型列表 |
| `ic provider model <model>` | 修改当前 Provider 的模型 |
| `ic provider doctor` | 检查当前 Provider 是否具备 API Key |
| `ic provider test` | 用极小 prompt 测试当前 Provider 是否可调用 |
| `ic provider test --json` | JSON 格式输出 Provider 连通性结果 |
| `ic provider env [name]` | 查看该 Provider 推荐的环境变量配置方式 |

### Setup

| 命令 | 说明 |
|------|------|
| `ic setup` | 首次安装向导，自动选择已配置 Key 的 Provider，否则使用 mock |
| `ic setup --mock` | 强制使用离线 mock provider |
| `ic setup --provider <name> [--model <model>]` | 指定默认 Provider 和模型 |
| `ic setup --json` | JSON 格式输出 setup 结果 |

### Agent 系统

| 命令 | 说明 |
|------|------|
| `ic agent "<描述>"` | 创建 Agent 执行任务 |
| `ic agent "<描述>" --type review` | 创建审查 Agent |
| `ic agent "<描述>" --background` | 后台运行 Agent |
| `ic agent --list` | 列出所有 Agent |
| `ic agent --stop <id>` | 终止 Agent |
| `ic agent --pause <id>` | 暂停 Agent |
| `ic agent --resume <id>` | 恢复 Agent |

### Skill 管理

| 命令 | 说明 |
|------|------|
| `ic skill ls` | 列出已安装 Skill |
| `ic skill info <name>` | 查看 Skill 详情 |
| `ic skill use <name>` | 在下一个任务中激活 Skill |
| `ic skill enable <name>` | 设为常驻 Skill |
| `ic skill disable <name>` | 停用 Skill |
| `ic skill add <path\|url>` | 安装新 Skill |
| `ic skill remove <name>` | 卸载 Skill |

## 支持的语言和框架

### 语言

TypeScript · JavaScript · Go · Rust · Python · Java · Kotlin · C# · PHP · Ruby · Swift · C · C++

### 框架

React · Vue · Next.js · Nuxt · Svelte · Angular · Express · NestJS · Django · Flask · FastAPI · Spring Boot · Gin · Laravel · Rails

### 数据库

PostgreSQL · MySQL · SQLite · MongoDB · Redis · Elasticsearch · DynamoDB

## 执行模式

| 模式 | 能力 | 默认 |
|------|------|------|
| **preview** | 分析项目、展示修改方案、生成 diff 预览 | ✓ |
| **execute** | 写入源码文件、运行构建/测试 | 需切换 |
| **privileged** | 修改配置、执行 git、自定义脚本 | 每次确认 |

## 验证管线

```
修改完成 → 编译检查 → Lint → 单元测试 → 集成测试 → ✅ 通过
              │          │       │          │
              └──────────┴───┬───┴──────────┘
                             │
                    失败 → AI 读取错误 → 自动修复 → 重试（最多 3 轮）
                             │
                    3 轮仍未通过 → 回滚 + 诊断报告
```

## 项目结构

```
.icloser/
├── icloser.json             # 项目配置
├── index.json               # 项目知识图谱
├── memory.json              # 项目记忆
├── audit.log                # 操作审计日志
├── tasks/<task-id>/
│   ├── task.json            # 任务数据
│   ├── plan.md              # 修改方案
│   ├── diff.patch           # 代码 diff
│   ├── reasoning.md         # 修改推理链
│   ├── verify.log           # 验证输出
│   └── report.md            # 中文任务报告
├── skills/                  # 项目级 Skill
└── rules.md                 # 架构约束
```

## 全局目录

```
~/.icloser/
├── config.json              # 全局配置（API Key 等）
└── global-memory/
    ├── memory.json          # 跨项目经验积累
    ├── tech-stack/          # 按技术栈组织的经验
    └── patterns/            # 跨项目设计模式
```

## 任务状态详情

`ic st <task-id>` 会展示任务的完整状态，包括：

### 基本信息
- 任务 ID、状态、描述、优先级、创建/开始/完成时间
- 修改文件数、推理记录数

### 验证阶段（有 verifyResult 时）
每个验证阶段展示：
- **状态图标**：`[✓]` 通过 / `[✗]` 失败 / `[!]` 跳过
- **耗时**：如 `(2.8s)`
- **退出码**：如 `exit=0` 或 `exit=1`
- **执行命令**：如 `$ npm run -s build`
- **失败摘要**：仅展示 stderr 的前 5 行关键信息（跳过 warning 行）

### 计划执行的验证命令（无 verifyResult 时）
未执行的任务展示**将会执行的验证命令**，来源为：
1. `package.json` scripts（优先）
2. 语言内置命令（回退）

```
  计划执行的验证命令:
  · compile            $ npm run -s build
  · lint               $ npx.cmd --no-install eslint . --max-warnings 0
  · unit-test          $ npm run -s test
```

### 门禁检查（有 gateResult 时）
- 整体结果：通过 / 阻塞（N 项）
- 安全门禁摘要：告警数 + 具体问题详情

### 验证日志
完整验证输出保存在 `.icloser/tasks/<task-id>/verify.log`。
使用 `ic log <task-id>` 查看完整报告。

## JSON 输出契约

所有 `--json` 输出遵循统一 envelope：

```json
{
  "version": 1,
  "kind": "<kind>",
  "data": { ... }
}
```

| 命令 | kind | data 内容 |
|------|------|----------|
| `ic config --json` | `config` | 项目/Provider/执行/安全/记忆摘要（不含 apiKey） |
| `ic doctor --json` | `doctor` | 项目初始化、Provider、索引、任务数、下一步动作 |
| `ic st --json` | `task-list` | `{ tasks: [...] }` |
| `ic st <id> --json` | `task` | 单个 Task 对象 |
| `ic gate <id> --json` | `gate-result` | `{ passed, checks: [...] }` |
| `ic config security rules --json` | `security-rules` | `{ disabledRules, rules: [...] }` |

- `version` 当前固定为 `1`，后续 breaking change 会递增
- `kind` 标识输出类型，方便脚本 dispatch
- `data` 包含实际载荷
- stdout 不含 ANSI 颜色码或进度文本，可直接 pipe 到 `jq` / `ConvertFrom-Json`
