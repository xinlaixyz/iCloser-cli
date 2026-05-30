# 黄金路径面板与评分验收文档

日期：2026-05-21

定位：**iCloser Agent Shell = 本地工程执行器 + Claude Code 替代品 + 长期记忆 Agent Shell**。

这份文档是后续开发的统一验收入口。以后不再按零散功能“散打”，所有改动都必须落到黄金路径、命令分组、真实样板任务和评分推进。

## 一、本轮任务清单

| 优先级 | 任务 | 用户价值 | 验收状态 |
|---|---|---|---|
| P0 | 建立“黄金路径面板” | 用户一眼看到 AI 做了什么、用了哪些工具、结果是什么 | 文档标准已建立，后续按此实现和验收 |
| P1 | 整理命令分组 | 用户不用从几十个命令里找入口 | 分组标准已建立：`setup/project/ai/tools/code/memory/collab/release` |
| P1 | 做 3 个真实样板任务 | 用真实项目证明能力，不只跑单元测试 | 样板任务已定义：网页访问、Android 需求转 H5 网页、修复 Web 项目 bug |
| P1 | 把评分写入验收文档 | 每轮按分数推进，不再只说“做了” | 评分模板已建立 |

## 一点五、2026-05-21 主链路重构落地

本轮已新增统一 AgentTaskLoop，并把 REPL 工具任务切入统一主循环：

| 任务 | 落地 |
|---|---|
| P0-1 统一 AgentTaskLoop | `src/core/agent-task-loop.ts` |
| P0-2 Provider Gateway | `src/ai/provider-gateway.ts` |
| P0-3 Evidence Store | `src/core/evidence-store.ts` |
| P0-4 Golden Path 状态机 | `src/core/golden-path-state.ts` |
| P0-5 Code Delivery Pipeline | `src/core/code-delivery-pipeline.ts` |
| P1-1 继续任务恢复 | `src/cli/repl.ts` 复用上一轮证据 |
| P1-3 记忆接入任务开始/结束 | `runAgentTaskLoop()` 支持 preload memory 与状态标记 |
| P1-4 README/help 产品化 | `README.md`、`doc/help.md` |

详细记录见：`doc/tasks/2026-05-21-agent-task-loop-rebuild.md`。

## 二、黄金路径面板标准

黄金路径面板必须出现在 AI 工具任务之后，尤其是网页访问、项目启动、代码修复、测试验证、发布检查这类任务。

### 2.1 面板信息架构

```text
◇ 用户需求
  用户原始输入、系统识别出的意图

● 采用记忆
  项目规则数、用户偏好数、相关历史数；没有也要明确说明

● AI 计划
  本轮准备做什么，是否需要执行命令，是否需要修改文件

Tools
  工具名  目标  状态  摘要

● 结果
  基于工具证据给出的答案、代码变更或启动状态

● 验证
  已验证什么、没验证什么、失败如何恢复

● 下一步
  用户可以继续做什么；系统建议的最短下一步
```

### 2.2 展示节奏

当前问题是 AI 内容一下子出来很多，缺少交互感。新的展示节奏应该是：

1. 先显示“理解需求”，让用户知道系统没有跑偏。
2. 工具调用实时逐条出现，每条只展示工具名、目标、状态和一行摘要。
3. 工具结果不要立即塞满屏幕，默认展示摘要，允许展开详情。
4. 最终答案必须在工具结果之后出现，并引用关键证据。
5. 追问时优先引用上一轮证据，必要时再补工具调用。

### 2.3 失败态标准

失败不能只说“失败了”。必须展示：

| 字段 | 示例 |
|---|---|
| 失败阶段 | Android 模拟器启动 |
| 原因 | AVD 系统镜像不存在 |
| 已尝试恢复 | 切换到 `test_avd`，检查 `adb devices` |
| 仍缺什么 | 本机缺少可用 system image |
| 下一步 | 安装 system image 或选择已有可启动 AVD |

## 三、命令分组标准

| 分组 | 面向用户的问题 | 主要命令 |
|---|---|---|
| `setup` | 怎么装、怎么配模型、为什么进不了 AI | `ic setup`、`ic doctor`、`ic provider list/test/doctor/key/use`、`/apikey` |
| `project` | 这个项目是什么、怎么启动 | `ic init`、`ic scan`、`ic project`、`ic android doctor/start` |
| `ai` | 让 AI 执行一个工程任务 | `ic`、`ic t`、`ic task-run`、`ic orchestrate` |
| `tools` | AI 可以调用哪些工具、结果是什么 | REPL 工具轨迹、`ic search`、`ic diff explain` |
| `code` | 改代码、修 bug、分析影响面 | `ic gen`、`ic code`、`ic impact`、`ic verify` |
| `memory` | 记住规则、查看采用了哪些记忆 | `ic mem status/edit/used/why/recall/import/export` |
| `collab` | 给团队交付 PR、commit、review 证据 | `ic collab issue/pr/review/audit/status`、`ic pr`、`ic commit-draft` |
| `release` | 能不能发布、质量门禁是否可信 | `ic release report`、`npm run release:trust`、`npm run release:checksum` |

验收要求：

- `/help` 与 README 后续必须按此分组改造。
- REPL 首页只展示高频入口，不展示全部命令。
- 每个分组都要有一句“用户问题”，避免纯工程命令列表。

## 四、三个真实样板任务

### 4.1 样板任务一：网页访问与追问

输入示例：

```text
你访问下这个网址 https://icloser.asia/，告诉我内容
具体是什么呀
```

必须验收：

- 首轮调用 `web_fetch` 或浏览器工具。
- 结果必须说明网页标题、页面定位、主要内容。
- 第二轮“具体是什么呀”必须复用上一轮网页证据，不允许跳到本地仓库代码。
- 黄金路径面板显示工具调用成功、提取摘要、最终回答。

失败判定：

- 工具成功但回答“让我看看”。
- 追问时改为读取 `package.json`、`src/cli/index.ts` 等无关本地文件。
- 没有说明网页到底是什么。

### 4.2 样板任务二：Android 需求转 H5 网页

项目路径：按实际需求选择，可在 `D:\temp\Codex\AgentFI` 或独立 H5 目录中验收。

输入示例：

```text
把这个 Android/App 需求转成 H5 网页
```

必须验收：

- 识别移动端需求、页面信息架构、关键交互和状态。
- 产出可运行 H5 页面，至少包含 HTML/CSS/JS 或前端组件。
- 页面必须适配移动端宽度，支持主要交互状态。
- 给出浏览器验收方式，能通过本地打开或 dev server 查看。
- 如果原需求缺少素材或接口，必须用占位数据并明确标注。

失败判定：

- 只输出设计建议，不生成可运行页面。
- 没有移动端适配。
- 没有说明如何在浏览器验收。
- 生成页面但无法打开或关键交互不可用。

### 4.3 样板任务三：修复 Web 项目 bug

项目路径：`D:\temp\Codex\AgentFI`

输入示例：

```text
修复这个 Web 项目的一个真实 bug，并给我验证证据
```

必须验收：

- 识别前端、后端、构建脚本、测试入口。
- 复现或定位一个真实问题。
- 产生最小代码 diff。
- 执行相关测试、构建或启动验证。
- 输出风险评估、影响面、回滚建议。

失败判定：

- 只给建议，不改代码。
- 改代码但没有验证。
- 验证失败后不修复、不解释。

## 五、评分推进模板

每轮开发完成后必须填写：

| 维度 | 开发前分数 | 目标分数 | 实际分数 | 证据 |
|---|---:|---:|---:|---|
| 首次启动与安装 | 7.3 | 待填 | 待填 | setup/doctor/首次启动记录 |
| 项目理解体验 | 8.0 | 待填 | 待填 | scan/context/项目画像 |
| 代码交付体验 | 7.2 | 待填 | 待填 | diff/verify/report |
| 工具执行可视化 | 7.0 | 待填 | 待填 | 黄金路径面板截图或日志 |
| 长期记忆体验 | 7.4 | 待填 | 待填 | 采用记忆、候选规则、写回记录 |
| 安全与掌控感 | 7.6 | 待填 | 待填 | 权限提示、危险命令拦截、回滚 |
| 失败恢复体验 | 7.0 | 待填 | 待填 | 失败分类、恢复尝试、下一步 |
| macOS 开发者体验 | 6.8 | 待填 | 待填 | macOS 安装和 smoke 记录 |
| 团队协作体验 | 6.2 | 待填 | 待填 | PR/commit/review/audit 产物 |
| 发布信任感 | 6.9 | 待填 | 待填 | release report、warning budget、checksum |

打分规则：

- 9 分以上：必须有真实项目证据，不接受只靠单元测试。
- 8 分以上：至少要有 smoke 或脚本化样板任务证据。
- 7 分以下：说明用户主路径仍有明显断点。
- 新增功能如果没有文档、没有测试、没有样板任务，不得给体验分加分。

## 六、下一步开发顺序

1. 实现或加固 REPL 黄金路径面板，把“工具结果 -> 最终回答”的关系固定下来。
2. 按 `setup/project/ai/tools/code/memory/collab/release` 改造 `/help` 和 README 命令展示。
3. 把三个真实样板任务做成可重复验收脚本或固定验收记录。
4. 每轮开发后更新本文件评分表，并在 `doc/CAPABILITY_MAP.md` 同步总分。

## 七、验收口径

本文件是后续 P0/P1 产品体验验收的主文档。以后讨论某个功能是否完成，不能只看代码是否存在，而要看：

- 用户是否看得懂 AI 做了什么。
- 工具结果是否被最终回答正确使用。
- 失败时是否有恢复路径。
- 是否能在三个真实样板任务里复现价值。
- 分数是否有证据支撑。
