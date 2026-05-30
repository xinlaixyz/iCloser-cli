# iCloser Agent Shell

iCloser 是一个终端里的 AI 工程助手：理解项目、精确改代码、自动验证，并交付可审查的变更。

产品定位：**本地工程执行器 + Claude Code 替代品 + 长期记忆 Agent Shell**。

## 安装

```bash
cd AgentCode
npm install
npm run build
npm link
```

## 快速开始

### 新用户路径

```bash
ic
```

进入后做两件事即可：

```text
◇  粘贴你的 API Key，然后回车
◇  直接告诉 iCloser 你想改什么
```

如果希望隐藏输入接口密钥：

```text
◇  /apikey
```

iCloser 会询问模型服务和 API Key，输入时不会明文显示。

首次启动时，iCloser 会显示三个选择：粘贴 API Key、使用 `/apikey`、或进入离线 Mock 模式。没有真实接口密钥也能先进入系统。

示例：

```text
◇  帮我给用户模块增加手机验证码登录
```

当 iCloser 展示文件变更时：

- 输入 `1` 写入文件。
- 输入 `2` 只预览。
- 输入 `3` 取消。

## 标准流程

```bash
# 1. 首次配置，三选一
ic setup --mock
ic setup --provider deepseek
ic setup --provider openai

# 2. 检查模型服务是否可用
ic provider test

# 3. 进入项目并初始化
cd my-project
ic init
ic doctor
ic doctor --strict

# 4. 创建并执行任务
ic t "给用户模块增加手机登录"
ic y <task-id>
ic gate <task-id>
ic r
```

`ic setup --mock` 会在没有真实 API Key 时自动使用离线 Mock 服务，方便先跑通流程。

`ic doctor` 会告诉你下一步该做什么：初始化项目、配置 API Key、扫描项目，或创建任务。

在 REPL 里可以使用 `/doctor` 查看同样的就绪检查，不需要退出当前会话。

如果启动 `ic` 时没有 API Key，REPL 仍会打开，并自动使用离线 Mock 模式。你可以随时粘贴真实 Key 切换到真实模型服务。

## 黄金路径面板

AI 工具任务应该按固定路径展示：

```text
理解需求 -> 采用记忆 -> 调用工具 -> 形成结果 -> 验证证据 -> 沉淀经验
```

用户应该一眼看到：

- AI 理解了什么需求。
- 本轮采用了哪些记忆。
- 调用了哪些工具。
- 工具结果是什么。
- 最终答案或代码变更是什么。
- 是否验证过；没有验证时下一步是什么。

详细验收标准见 `doc/GOLDEN_PATH_AND_SCORE_ACCEPTANCE_2026-05-21.md`。

## 发布前冒烟测试

每次推送或合并 PR 前建议运行：

```bash
npm run smoke
npm run smoke:project
```

完整本地验收：

```bash
npm run smoke:all
```

`npm run smoke` 会执行核心验收链路：

1. `npm run build` 和 `npm run test`。
2. 创建临时项目。
3. `ic setup --mock --json` 到 `ic init`。
4. `ic provider use mock` 到 `ic provider test --json`。
5. `ic doctor --json`。
6. `ic t "..." --go`，执行完整任务链路。
7. `ic status --json`、`ic gate --json`、`ic report`。

退出码为 0 表示核心链路通过。默认使用 Mock 服务，不需要真实 API Key。

如果要保留临时项目用于调试，可以设置 `ICLOSER_KEEP_SMOKE=1`，或运行：

```bash
npm run smoke:keep
```

常用冒烟入口：

| 命令 | 用途 |
|------|------|
| `npm run smoke:project` | 创建小型 TypeScript 项目并验证真实项目形态 |
| `npm run smoke:first-run` | 验证首次启动、配置持久化、接口密钥安全 |
| `npm run smoke:repl` | 验证 REPL、`/apikey`、`/status`、`/exit` |
| `npm run smoke:repl:init` | 验证 `/doctor`、`/init`、`/scan` |
| `npm run smoke:repl:e2e` | 验证新用户端到端路径 |
| `npm run smoke:all` | 汇总运行构建、测试、REPL、记忆、发布、真实项目冒烟 |

## CI 发布门禁

`.github/workflows/smoke.yml` 会在 PR 和主分支推送时运行：

| 项目 | 配置 |
|------|------|
| 系统 | `windows-latest` |
| Node | 22 |
| 步骤 | checkout、`npm ci`、`npm run smoke` |
| 超时 | 10 分钟 |

冒烟失败表示 PR 尚不能合并。推送前请先在本地运行 `npm run smoke`。

## API Key 与模型服务管理

iCloser 支持三种接口密钥路径：

1. 新手路径：打开 `ic`，粘贴 API Key，回车。系统会保存到用户全局配置并自动切换模型服务。
2. 高级路径：设置环境变量。
3. 测试路径：使用 `ic setup --key sk-xxx`，适合 CI 和自动化测试。

JSON 输出不会暴露已保存的 API Key。

直接粘贴：

```text
◇  sk-xxxxxxxxxxxxxxxx
```

明确指定 DeepSeek：

```text
◇  /apikey deepseek sk-xxxxxxxxxxxxxxxx
```

| 模型服务 | 环境变量 |
|----------|----------|
| DeepSeek | `DEEPSEEK_API_KEY` |
| Claude | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Qwen | `QWEN_API_KEY` 或 `DASHSCOPE_API_KEY` |
| Mock | 不需要 |

PowerShell：

```bash
$env:DEEPSEEK_API_KEY = "sk-xxx"
```

Bash / Zsh：

```bash
export DEEPSEEK_API_KEY="sk-xxx"
```

Windows CMD：

```bash
set DEEPSEEK_API_KEY=sk-xxx
```

还没有 Key 时：

```bash
ic setup --mock
ic
```

系统会进入离线 Mock 模式，`/status`、`/scan`、`/verify`、`/search` 和 Mock 任务流仍然可用。后续随时粘贴 Key 即可切换真实模型服务。

## 切换模型服务

```bash
ic provider list
ic provider key deepseek sk-xxx
ic provider use deepseek
ic provider models openai
ic provider doctor
ic doctor
ic doctor --strict --json
ic provider env openai
```

## JSON 输出

所有 `--json` 输出使用统一信封：

```json
{"version": 1, "kind": "<kind>", "data": {...}}
```

常用 JSON 命令：

```bash
ic config --json
ic doctor --json
ic doctor --strict --json
ic st --json
ic gate <task-id> --json
ic config security rules --json
ic provider list --json
ic provider doctor --json
ic setup --mock --json
```

## 高级配置：ICLOSER_HOME

默认全局配置目录是 `~/.icloser`。可以用 `ICLOSER_HOME` 指定独立目录：

```bash
ICLOSER_HOME=/tmp/ci-icloser ic setup --mock
ICLOSER_HOME=/tmp/ci-icloser ic config
```

这个能力适合 CI、测试和沙箱环境。

## 命令分组

| 分组 | 用户问题 | 主要入口 |
|------|----------|----------|
| `setup` | 怎么安装、配置模型服务、排查为什么进不了 AI | `ic setup`、`ic doctor`、`ic provider`、`/apikey` |
| `project` | 这个项目是什么、怎么扫描、怎么启动 | `ic init`、`ic scan`、`ic android` |
| `ai` | 让 AI 执行一个工程任务 | `ic`、`ic t "需求"`、`ic task-run`、`ic orchestrate` |
| `tools` | AI 用了哪些工具、结果是什么 | REPL 工具轨迹、`ic search`、`ic diff explain` |
| `code` | 生成、修复、重构、验证代码 | `ic gen`、`ic code`、`ic impact`、`ic verify` |
| `memory` | 查看和维护长期记忆 | `ic mem`、`ic mem edit`、`ic mem used`、`ic mem why` |
| `collab` | 生成 PR、commit、review、审计材料 | `ic collab`、`ic pr`、`ic commit-draft` |
| `release` | 判断能不能发布 | `ic release report`、`npm run release:trust`、`npm run release:checksum` |

完整命令参考见 `doc/help.md`。
