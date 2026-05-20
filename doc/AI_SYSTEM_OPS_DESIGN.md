# AI 全系统操作能力设计

## 核心思路

从"30+ CLI 命令"升级为"**自然语言工程工作台**"。

用户不需要记住命令，只需说出意图：

```
现在：ic t "分析项目" --go          → 用户需知道 ic t --go
目标：◇ 分析这个项目                 → 系统自动理解意图 → 执行

现在：ic docs generate               → 用户需知道 ic docs
目标：◇ 帮我补全所有项目文档           → 系统自动理解 → 执行

现在：ic provider use deepseek       → 用户需知道 provider 命令
目标：◇ 切换到 deepseek 模型          → 系统自动理解 → 执行
```

## 10 域 AI 操作能力

### 域 1: 项目理解与分析

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| A1 | "分析这个项目" | init→scan→assembleContext→AI分析→输出报告 |
| A2 | "这个项目用了什么技术" | 检测语言/框架/数据库→表格展示 |
| A3 | "项目完成度怎么样" | 读任务+报告→阻塞项→完成度评估 |
| A4 | "帮我找到所有API接口" | search_code→提取路由→列表 |
| A5 | "这个项目的架构是什么" | 模块检测→依赖图→架构总结 |
| A6 | "代码质量怎么样" | lint→重复代码→复杂度→报告 |
| A7 | "有哪些安全风险" | 安全扫描→密钥检测→SQL注入→报告 |

### 域 2: 任务执行

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| B1 | "给登录加个验证码" | plan→确认→AI生成代码→写入→验证→报告 |
| B2 | "修复这个bug" | 读错误→定位代码→生成修复→验证 |
| B3 | "重试上次失败的任务" | loadTask→retry→execute |
| B4 | "把所有ESLint错误修了" | read lint output→AI修复→验证 |
| B5 | "重构这个函数，太长了" | read→refactor→write→verify |
| B6 | "回滚刚才的修改" | 读任务→rollback→恢复 |

### 域 3: 文档操作

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| C1 | "帮我补全所有文档" | scan gap→generate all→quality check |
| C2 | "JWT认证怎么实现的" | read docs→AI回答+引用来源 |
| C3 | "把API文档翻译成英文" | read→translate→write API.en.md |
| C4 | "给PRD加一个权限管理需求" | read→edit section→diff→ask confirm→write |
| C5 | "审查这个文档有什么问题" | read→quality check→标注问题→报告 |
| C6 | "从git log生成更新日志" | git log→AI分类→CHANGELOG.md |

### 域 4: 配置管理

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| D1 | "切换到deepseek" | provider use deepseek→test |
| D2 | "配置API Key" | 引导输入→保存→验证 |
| D3 | "检查连接状态" | provider test→显示结果 |
| D4 | "换一个更快的模型" | list models→AI推荐→切换 |
| D5 | "当前用的是哪个模型" | config→显示provider+model |
| D6 | "查看所有可用模型" | provider list→格式化表格 |

### 域 5: DevOps

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| E1 | "启动项目" | 子目录扫描→多服务检测→确认→启动 |
| E2 | "停止所有服务" | 列出进程→确认→停止 |
| E3 | "重启后端" | stop backend→start backend |
| E4 | "项目跑在哪个端口" | 检查运行进程→显示URL |
| E5 | "跑一下测试" | detect test command→run→显示结果 |
| E6 | "构建项目" | detect build command→run→显示结果 |

### 域 6: 代码智能

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| F1 | "谁调用了getUser函数" | code_intel→callers→列表 |
| F2 | "这个函数在哪个文件" | search→定位→显示文件:行号 |
| F3 | "帮我看下这个文件是做什么的" | read→AI总结→一句话描述 |
| F4 | "找出所有TODO注释" | search_code→提取→列表 |
| F5 | "有哪些未使用的导入" | code_intel→check imports→列表 |
| F6 | "这个模块依赖了哪些包" | 读go.mod/package.json→列表 |

### 域 7: Agent 编排

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| G1 | "并行分析代码质量和安全" | orchestrate→3 agents→汇总 |
| G2 | "有哪些Agent在运行" | agent list→状态表格 |
| G3 | "让Agent审查这段代码" | create review agent→execute→report |
| G4 | "停止所有Agent" | stop all→确认 |

### 域 8: 记忆与知识

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| H1 | "记住：这个项目用 snake_case" | save rule→memory |
| H2 | "之前怎么解决过类似问题" | search memory→显示 |
| H3 | "有什么需要我确认的" | memory review→列表 |
| H4 | "把这个经验保存为规则" | extract→confirm→save |

### 域 9: PM/管理

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| I1 | "项目能发布吗" | release-status→显示阻塞项 |
| I2 | "路线图进度怎么样" | roadmap→里程碑进度条 |
| I3 | "有哪些风险" | risk matrix→表格 |
| I4 | "评估这个需求的复杂度" | estimate→points+days |
| I5 | "谁在阻塞发布" | deps→阻塞链→责任任务 |
| I6 | "生成一份周报" | 汇总tasks→生成PM报告 |

### 域 10: 自我管理

| # | 自然语言示例 | AI 自动执行 |
|---|-------------|------------|
| J1 | "你现在用了多少token" | 显示本次会话用量 |
| J2 | "清空对话历史" | clear |
| J3 | "保存当前会话" | save session |
| J4 | "你支持哪些命令" | help→格式化显示 |

## 实现架构

```
用户自然语言输入
  │
  ├─ 1. 意图识别 (classifyIntentRegex + classifyIntentAI)
  │      → 域 + 操作 + 参数提取
  │
  ├─ 2. 参数补全
  │     "分析项目" → {domain:analysis, action:analyze, target:current_project}
  │     "启动项目" → {domain:devops, action:start, target:auto_detect}
  │
  ├─ 3. 操作路由
  │     domain=analysis → 调用分析管线
  │     domain=devops   → 调用启动管线
  │     domain=docs     → 调用文档管线
  │     domain=task     → 调用任务管线
  │     ...
  │
  ├─ 4. 确认(需要时)
  │     "这个操作会修改3个文件，确认？"
  │     [1] 确认  [2] 预览  [3] 取消
  │
  └─ 5. 执行 + 反馈
        ✓ 完成 → 显示结果
        ✗ 失败 → AI 给出建议
```

## 优先级

| 优先级 | 域 | 数量 | 说明 |
|--------|-----|------|------|
| 🔴 P0 | 域1 分析 + 域2 任务 | 13 | 核心能力，已有基础设施 |
| 🔴 P0 | 域5 DevOps | 6 | 刚完成启动增强，只需加路由 |
| 🟡 P1 | 域3 文档 + 域9 PM | 12 | 已有 ic docs，需加自然语言路由 |
| 🟡 P1 | 域4 配置 + 域6 代码 | 12 | 命令已存在，需包装为自然语言 |
| 🟢 P2 | 域7 Agent + 域8 记忆 | 8 | 已有基础设施 |
| ⚪ P3 | 域10 自我管理 | 4 | 增强体验 |
| | **总计** | **55 项** | |

## 最小可行产品 (MVP)

只做 P0 的 19 项（域1+2+5），覆盖 80% 日常使用场景：

```
◇ 分析项目              → 自动执行全部分析管线
◇ 帮我修复这个bug        → 读错误→改代码→验证
◇ 启动项目              → 子目录扫描→并行启动
◇ 停止服务              → 列出→确认→停止
◇ 查看日志              → tail -f
◇ 跑测试                → 自动检测→运行
◇ ...
```
