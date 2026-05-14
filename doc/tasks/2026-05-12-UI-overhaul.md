# Task: Chat UI 全面重做

**日期：** 2026-05-12
**执行者：** Claude (S1)
**状态：** ✅ 完成
**类型：** enhancement / UI

## 需求来源

用户反馈 4 个 UI 问题：
1. 聊天窗体的边框线没有把内容包起来
2. 启动界面太小气，不够大气
3. AI 等待状态和 Agent 处理过程显示不完善
4. 命令行中的记录和数据没有在前端展示给用户

## 改动范围

### 1. `src/cli/theme.ts` — 完全重写 (297行)

**新增功能：**

| 函数 | 用途 |
|------|------|
| `termWidth()` | 获取终端宽度，用于自适应布局 |
| `drawBox()` | 通用 Box 绘制，自动计算内容宽度 + 标题 + 内边距 |
| `drawWideBox()` | 宽 Box 绘制，用于状态/配置展示 |
| `processStep()` | 流程步骤指示器 `○ [1/3] 编译检查` → `✓ [1/3] 编译检查` |
| `agentCard()` | Agent 状态卡片，显示 ID/类型/状态/耗时/Token |
| `notification()` | 通知横幅 (info/warn/error/success) |
| `thinDivider()` | 自适应宽度分隔线 |
| `aiHeader()` / `aiFooter()` | AI 回复框的自动宽度头尾 |

**重写的函数：**

| 函数 | 改动 |
|------|------|
| `welcomeScreen()` | 全新启动画面：使用 ═ 双线框，自适应终端宽度，显示 Provider/Model/OS/Node版本/时间/项目名，品牌标识居中粗体 |
| `commandHelp()` | 帮助文本使用自适应宽度的 box，命令分组显示 |
| `statusBar()` | 增加 AI provider 信息，自适应截断 |

**新增常量：**
- `C.primaryBg`, `C.accentBg`, `C.successBold`, `C.warnBold`, `C.errorBold`, `C.infoBold`, `C.muted`
- `B.vl`, `B.vr` (轻量竖线), `B.dblH`, `B.dblV` (双线), `B.dot`(●), `B.hollowDot`(○), `B.bullet`(▪), `B.diamond`(◆)
- `I.running`(◉), `I.waiting`(◌), `I.hollow`(○), `I.spark`(◆)
- `PULSE` spinner 帧

### 2. `src/cli/repl.ts` — 多处修改

**聊天流式输出框修复：**
- Box 宽度从固定 `'─'.repeat(20)` 改为 `termWidth() - 6`（自适应终端宽度）
- 每行内容补全右侧空格到 box 右边界
- 新增 `renderWrappedLine()` 函数：长文本自动换行
- 新增 `stripAnsiLen()` 函数：正确计算不含 ANSI 转义码的字符串长度
- 代码块/标题/列表项统一计算 padding
- 底部 footer 显示 Token 数和耗时

**启动流程重构：**
- `detectProjectContext()` 提前到 welcome 前执行
- welcome screen 传入项目名
- 无 API key 警告改用 `notification()` 横幅
- 会话恢复提示改用 `notification()` 横幅
- status bar 增加 AI provider 显示

**状态与进度显示改进：**
- `startSpinner()` 增加上下文信息轮换：思考中 → 检索相关文件中 → 分析项目上下文 → 生成回复中
- 显示已等待时间（秒）
- `/status` 命令：使用 `drawWideBox()`，显示 Token 使用百分比、活跃 Agent 数、架构信息
- `/config` 命令：使用 `drawWideBox()`，显示 API Key 配置状态
- `/scan` 命令：使用 `drawWideBox()`
- `/agents` 命令：增加 Agent 概览（运行中/完成/失败计数），时间戳

**写入/验证流程改进：**
- `cmdWrite()` 增加文件写入分组头部 + 分隔线
- 显示 NEW/MOD 标记
- 显示总行数统计
- 使用 `processStep()` 显示验证进度

**Agent 运行：**
- `cmdRunAgent()` 使用 `agentCard()` 显示启动/完成/失败状态
- 显示耗时、Token 用量

**自动修复循环：**
- 使用 `processStep()` 显示修复轮次
- 修复文件写入使用分隔线分组
- 达到上限时使用 `notification()` 横幅 + 错误摘要

## 设计原则

1. **自适应宽度** — 所有 box 使用 `termWidth()` 计算，响应终端 resize
2. **box 内右对齐** — 每行内容补全空格到右边界，视觉上完整闭合
3. **信息密度** — 在有限的终端空间内展示更多有用信息（Token%、耗时、状态计数）
4. **中文优先** — 所有提示文本使用中文
5. **渐进展示** — 流程步骤 (`processStep`) 逐一展示，让用户感知进度

## 验证

- TypeScript 编译通过：`npx tsc --noEmit` ✓
- Box 宽度计算方法已验证
- Box 边框 + 内容 padding 构成完整闭合

## 相关文件

- `src/cli/theme.ts` — UI 设计系统
- `src/cli/repl.ts` — REPL 交互逻辑
- `src/cli/output.ts` — 命令输出格式化（未改动，theme 已覆盖其功能）
