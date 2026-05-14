# S13-S16 前进计划

日期：2026-05-14
状态：S1-S12 已完成。S13-S16 待执行。

## 已完成阶段速查

| 阶段 | 内容 | 负责人 |
|------|------|--------|
| S8 | tree-sitter AST 解析器 (TS/JS) + scanner 集成 | dev1 |
| S9 | Agent Manager（多 Agent 编排）+ 多语言 AST | dev1+dev3 |
| S10 | 网络搜索 (DuckDuckGo) + 上下文注入 | dev3 |
| S11 | 跨文件调用图 + 增量扫描指纹 | dev3 |
| S12 | Agent CLI/REPL 集成 + web-search/agent smoke | dev3 |

## S13: Task → Agent 自动桥接（dev3）

### 目标
`ic t "任务描述" --go` 执行时自动创建 Agent，Agent 调用 AI 执行，结果回写 task。

### 范围
- `src/core/task-engine.ts`：`executeTask()` 集成 AgentManager
- `src/index.ts`：task chain (`ic t --go`) 打通 Agent 路径
- `tests/task-agent-bridge.test.ts`

### 验收
```bash
npm run build
npm run test -- task-agent-bridge
ic t "用一句话介绍你自己" --go    # 走 mock，Agent 自动创建并执行
```

## S14: Agent Sandbox + 安全隔离（dev3）

### 目标
Agent 的 `sandboxLevel` 字段真正生效：
- `readonly`：Agent 不可写文件
- `isolated`：Agent 不可访问项目外路径

### 范围
- `src/core/security.ts`：Agent sandbox 检查
- `src/agent/manager.ts`：`runAgent()` 调用前检查 sandbox 权限
- `tests/agent-sandbox.test.ts`

### 验收
- readonly Agent 尝试写文件 → 拒绝 + 日志
- isolated Agent 尝试读 `/etc/passwd` → 拒绝

## S15: Agent → Report 整合（dev3）

### 目标
Agent 执行结果纳入任务报告。`ic r` 能看到：
- 哪些 Agent 参与了任务
- 每个 Agent 的输入/输出/token 消耗
- Agent 层级树可视化

### 范围
- `src/report/generator.ts`：Agent 执行摘要
- `src/agent/manager.ts`：导出 Agent 执行历史
- `tests/report-agent.test.ts`

### 验收
```bash
ic t "分析项目" --go
ic r    # 报告中包含 Agent 执行摘要
```

## S16: 真实验收 + 文档完善（dev3）

### 目标
用真实 DeepSeek API Key 做一次完整的端到端测试，修 bug，补文档。

### 范围
- `doc/` 补全：DEVELOPMENT.md 补 S8-S16 阶段记录
- `doc/ARCHITECTURE.md` 更新 Agent 子系统章节
- 真实 AI 端到端测试：`ic t "分析当前项目代码质量" --go`
- `smoke:all` 完整通过

### 验收
```bash
npm run build
npm run test              # ≥ 330 tests
npm run smoke:all         # 全链通过
ic provider test          # DeepSeek 连接 ok
ic t "分析项目" --go       # 真实 AI 分析 + Agent 执行 + 报告
```

## 汇总

```
S13 → Task↔Agent 自动桥接 (400测试)
S14 → Agent 安全沙箱      (200测试)
S15 → Agent→Report 整合   (300测试)
S16 → 真实验收+文档       (端到端)
```
