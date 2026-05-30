# 项目启动能力差距分析

## 对比基准

同一项目 `D:\temp\Codex\AgentFI`（monorepo：agentfi-web + agentfi-server），同一模型。

### 对比工具做了什么

| 步骤 | 操作 |
|------|------|
| 1 | 搜索项目结构和上下文 |
| 2 | 读取多个文件理解 monorepo 布局 |
| 3 | 发现前端 (React+Vite) + 后端 (Spring Boot) |
| 4 | 运行 `./mvnw.cmd spring-boot:run` (后端) |
| 5 | 运行 `npm run dev` (前端) |
| 6 | 追踪两个后台进程 |
| 7 | **表格展示**服务/地址/状态 |
| 8 | 7 分钟完成 |

### iCloser 做了什么

| 操作 | 结果 |
|------|------|
| 检查根目录 package.json | ❌ 不存在 |
| 显示 "当前目录没有 package.json" | 失败 |
| 建议 "用 /cd 切到项目根目录" | 用户已在根目录 |

## 5 个断层

### 断层 S1：无子目录项目发现
**根因**：`cmdStartProject` 只检查 `cwd/package.json`，不扫描子目录。
**影响**：monorepo（`agentfi-web/` + `agentfi-server/`）无法被识别。

### 断层 S2：无多项目启动
**根因**：`startedProcesses` 数组只跟踪单个进程，无并发启动。
**影响**：前后端分离项目需要两次手动启动。

### 断层 S3：无跨平台命令适配
**根因**：启动命令硬编码为 npm/node，不支持 `mvnw.cmd`、`gradlew`、`go run`。
**影响**：Java/Python/Go 项目无法启动。

### 断层 S4：无服务状态表格
**根因**：无多服务追踪，无端口检测，无表格渲染。
**影响**：看不到哪些服务在运行、访问地址是什么。

### 断层 S5：无依赖检查
**根因**：只检查 `node_modules` 是否存在，不检查 `mvn install`、`go mod download`。
**影响**：依赖未安装时静默失败。

## 解决方案

```
用户输入 "启动项目"
  │
  ├─ 1. 子目录扫描 (depth 2)
  │     发现 agentfi-web/package.json  → 前端 (npm)
  │     发现 agentfi-server/pom.xml    → 后端 (maven)
  │     发现 agentfi-server/mvnw.cmd   → 使用 maven wrapper
  │     (如只有1个，直接启动；多个则列出)
  │
  ├─ 2. 依赖检查
  │     agentfi-web: node_modules 存在？
  │     agentfi-server: .mvn/wrapper 存在？
  │
  ├─ 3. 并发启动 (2 个后台进程)
  │     backend  → mvnw spring-boot:run
  │     frontend → npm run dev
  │
  ├─ 4. 端口/URL 检测 (轮询 stdout)
  │     前端 → http://127.0.0.1:5173
  │     后端 → http://localhost:8080
  │
  └─ 5. 状态表格展示
       ┌──────────┬────────────────────┬────────┐
       │ 服务     │ 地址               │ 状态   │
       ├──────────┼────────────────────┼────────┤
       │ 前端     │ http://127.0.0.1:5173│ 运行中 │
       │ 后端     │ http://localhost:8080│ 运行中 │
       └──────────┴────────────────────┴────────┘
```

已在代码中（本轮刚完成 S1+S3 部分：Go/Python/Rust/Docker/Makefile 检测），下一步完成 S2+S4+S5。
