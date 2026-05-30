# iCloser Agent Shell Grand Terminal UI 执行方案

日期：2026-05-21  
状态：已进入实现基线，继续细化  
范围：REPL 启动首屏、会话恢复提示、工具执行展示、AI 输出节奏

## 1. 背景

当前 REPL 首屏已经能展示品牌、Provider、Project 和快捷命令，但视觉观感偏“小工具化”：主框内部留白松散、右侧装饰缺少信息价值、恢复会话卡片突兀、状态信息重复。多轮字符 logo 尝试后确认：默认首屏应优先保证工程工作台的清晰、稳定和可信，不再强行展示低保真终端 logo。

品牌必须保持：

```text
i C l o s e r   Agent Shell
Terminal AI Engineering Assistant
```

## 2. 设计目标

- 第一眼大气：像工程指挥台，而不是脚本欢迎页。
- 品牌明确：`i C l o s e r Agent Shell` 是首屏唯一主视觉。
- 终端可信：信息排布克制、稳定、可扫描，不使用廉价装饰。
- 交互有节奏：AI 不能一下子输出一大坨内容，必须展示思考阶段、工具调用、结果归纳和下一步。
- 跨平台舒适：Windows Terminal、PowerShell、macOS Terminal、iTerm2 下都不能错位。

## 3. 已确认视觉方向

风格名：**Grand Terminal Console**

关键词：

```text
大气 / 克制 / 工程感 / 指挥台 / 黑底银灰 / 青绿状态 / 紫色点缀 / FC 像素加密朋克
```

视觉规则：

- 主背景：黑色或深炭灰。
- 主文字：银白、灰白。
- 状态成功：青绿。
- 当前动作：冷青色。
- AI/Memory 点缀：低饱和紫。
- 警告：琥珀。
- 错误：柔红。
- 不使用大面积紫色边框。
- 不使用右侧无意义 ASCII 装饰。
- 不使用 logo 外框、卡片边框、红色占位框。

## 4. Logo 放置规则

Logo 来自用户提供的 `D:/Onedrive/Pictures/LOGO/iCloser-LOGOvector.svg` 视觉母版，目标风格为 FC 类加密朋克像素风。

设计要求：

- 默认启动首屏不展示低保真字符 logo。
- Logo 只在支持图片协议、`/logo`、README 或品牌页中展示。
- 若未来恢复默认首屏 logo，必须先通过人工截图验收。
- Logo 必须是自然嵌入，不加方框、不加边框、不加卡片底。
- Logo 视觉元素：电路化 C、加密/安全锁盾牌、终端工程感。
- Logo 应像透明背景像素徽记，贴合终端背景。
- Logo 不应抢主标题，尺寸约占主框高度的 20%-30%。
- 半块采样方案锯齿感强，Braille 方案细节过密，轮廓方案低质感明显；这些方案不得作为默认首屏。

终端图片能力分级：

| 能力 | 表现 |
| --- | --- |
| 支持图片协议 | 显示像素 logo 图片 |
| 不支持图片协议 | 默认不显示 logo |
| 宽度不足 | 隐藏 logo，仅保留品牌和状态信息 |

## 5. 启动首屏布局

目标布局：

```text
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   i C l o s e r   Agent Shell                                              ║
║   Terminal AI Engineering Assistant                                          ║
║                                                                              ║
║   PROJECT     Polymarket                PROVIDER    deepseek / deepseek-v4   ║
║   WORKSPACE   D:\temp\Codex\Polymarket   MEMORY      12 rules · 3 relevant   ║
║   STACK       Android · Gradle           CONTEXT     5.9K / 100K             ║
║                                                                              ║
║   Ready for engineering work: scan · edit · test · launch · explain          ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Session restored   15 messages · last topic: 启动项目

  /help   /scan   /diff   /mem   /start   /clear
```

布局要求：

- 首屏宽度优先控制在 96 columns 内，低于 86 columns 时自动紧凑。
- 不再在欢迎屏后追加重复 `PROJECT / LANG / FRAMEWORK / AI` 状态栏。
- `Session restored` 融入主视觉下方，不再使用小卡片。
- `Ready for engineering work` 固定放在主框底部，作为产品承诺。
- 中英文混排使用固定列宽，避免漂移。
- Quick start 必须拆成三行短句，不能把多个中文长句塞入一行。
- 补齐 `FLOW / EVIDENCE / CONTROL`，让首屏像工程工作台，而不是欢迎海报。
- Quick start 输入若已经带编号，渲染层必须去重，不能出现 `1  1`。

当前实现基线：

```text
i C l o s e r   Agent Shell
Terminal AI Engineering Assistant

PROJECT   当前项目                  PROVIDER  deepseek / deepseek-v4-pro
WORKSPACE 当前路径                  MEMORY    auto recall · project rules
STACK     Auto detected / Run /scan CONTEXT   live budget · compressed history
FLOW      ask → plan → tools → diff → verify
EVIDENCE  tool calls visible in real time
CONTROL   review before write / commit

Ready: scan · edit · test · launch · explain
Quick start
  1  直接输入需求
  2  /scan 扫描项目
  3  /help 查看所有命令和快捷键
```

## 6. AI 输出交互感改造

### 6.1 当前问题

用户反馈：AI 内容一下子出来很多，一点交互感都没有。

具体表现：

- 大段最终答案直接出现，用户看不到过程。
- 工具调用虽然有日志，但没有形成“任务正在推进”的节奏。
- AI 输出和工具输出混在一起，像流水账。
- 长内容缺少分段、暂停、摘要、下一步提示。
- 用户无法判断：AI 在想、在读、在跑命令、还是已经完成。

### 6.2 目标体验

AI 输出必须从“结果倾倒”改成“分阶段陪跑”：

```text
◇ 启动项目

  ● 理解启动需求
  ● 识别 Android / Gradle 项目
  ● 检查 SDK、ADB 与模拟器
  ● 构建并安装 APK
  ● 启动 MainActivity

Tools
  ✓ read_file      app/build.gradle.kts          4.3K
  ✓ read_file      gradle/libs.versions.toml     6.4K
  ✓ run_command    adb devices                   emulator-5554 device
  ✓ run_command    gradlew installDebug          BUILD SUCCESSFUL
  ✓ run_command    monkey launch                 MainActivity foreground

Result
  应用已启动，MainActivity 位于前台。
```

### 6.3 输出节奏规则

- 进入任务后先显示任务标题和 3-6 个阶段。
- 每次工具调用前显示“为什么调用”或阶段名。
- 工具完成后只显示一行高信号摘要。
- 长 AI 文本按段输出，每段 3-6 行。
- 超过 12 行的解释默认折叠为摘要 + `展开详情` 提示。
- 代码 diff、命令日志、测试失败详情默认折叠，只展示关键错误。
- 输出过程中保持可中断：`Ctrl+C 中断`。
- 任务完成后必须有 `Result` 或 `Next`，不能戛然而止。

### 6.4 流式输出策略

分四层渲染：

| 层级 | 展示内容 | 频率 |
| --- | --- | --- |
| Thinking | 当前阶段：分析/读取/验证/修复 | 立即显示 |
| Tool Call | 工具名、目标、原因 | 工具执行前 |
| Tool Result | 一行摘要、状态、关键数字 | 工具完成后 |
| Answer | 分段自然语言结论 | 流式或按段输出 |

建议输出控制：

- 首 token 超过 1 秒未到：显示 `AI 分析中 [1.0s]`。
- 每 500-800ms 刷新等待状态，不刷屏。
- 每个段落输出后可短暂停顿 80-150ms，制造阅读节奏。
- 对最终报告使用 “Summary / Evidence / Next” 三段，而不是一整块。

### 6.5 重复工具降噪

重复读取文件不再显示警告式大段文字，改为：

```text
  ↻ read_file      build.gradle.kts              reused from cache
```

原则：

- 缓存命中是正常优化，不应表现成警告。
- 重复工具结果只显示一次详情，后续用 `reused from cache`。
- 工具结果超过 3 行时默认压缩。

## 7. 开发拆解

| ID | 任务 | 文件范围 | 验收 |
| --- | --- | --- | --- |
| UI-G1 | Grand Terminal 启动首屏 | `src/cli/theme.ts`, `src/cli/repl.ts` | 首屏大气、无重复状态栏、logo 无边框 |
| UI-G2 | 会话恢复展示重构 | `src/cli/repl.ts`, `src/cli/theme.ts` | `Session restored` 融入主视觉下方 |
| UI-G3 | Logo 能力探测与降级 | `src/cli/theme.ts` 或独立模块 | 支持图片时显示 logo，不支持时降级 |
| UI-I1 | AI 输出阶段化 | `src/cli/repl.ts`, `src/cli/tool-display.ts`, `src/core/tool-loop.ts` | 任务先显示阶段，结果分段 |
| UI-I2 | 工具结果表格化 | `src/cli/tool-display.ts` | 工具输出一行摘要，重复读取降噪 |
| UI-I3 | 长内容折叠与节奏控制 | `src/cli/repl.ts` | 大段内容不一次性倾倒 |

## 8. 验收标准

- 启动首屏第一眼能看出产品名和定位。
- Logo 无边框、无卡片、无红色占位感。
- 首屏不再重复 Project/AI 状态。
- 80/100/120 columns 下不出现明显错位。
- 80/110 columns 下所有行 display width 不超过终端宽度，已有自动化测试覆盖。
- 用户输入“启动项目”后，先看到阶段推进，而不是直接大段回答。
- 工具调用结果可以快速扫描。
- 重复读取文件不会刷 warning。
- 长回答具有摘要、证据、下一步结构。
- Windows Terminal 与 macOS Terminal 都需要人工截图验收。

## 9. 后续细化项

- 把大尺寸采样 logo 做成 `/logo` 命令或帮助页品牌展示。
- 增加真实终端截图验收：Windows Terminal、PowerShell、macOS Terminal、iTerm2。
- 若终端支持图片协议，再提供高保真图片 logo；默认仍保留 ANSI 降级。
