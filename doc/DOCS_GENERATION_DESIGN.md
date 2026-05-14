# 产品文档自动生成能力设计

## 用户视角

PM 执行一条命令，系统自动从用户视角生成全套产品文档：

```bash
ic docs generate    # 分析项目 → 发现缺失 → 生成全部文档
```

输出：
```
docs/
├── PRD.md              # 产品需求文档
├── USER_GUIDE.md        # 用户使用手册
├── API.md               # API 接口文档
├── ARCHITECTURE.md      # 架构设计文档
├── TESTING.md           # 测试策略文档
├── DEPLOYMENT.md        # 部署运维手册
├── CHANGELOG.md         # 版本变更记录
├── FAQ.md               # 常见问题
└── CONTRIBUTING.md      # 贡献指南
```

---

## 当前能力 vs 目标

| 能力 | 当前 (`ic autopilot`) | 目标 (`ic docs generate`) |
|------|----------------------|--------------------------|
| 文档缺口检测 | ✅ 列出缺失文档名 | ✅ 同 |
| 文档生成 | ⚠️ 只生成空模板 | ✅ AI 读取代码后生成完整内容 |
| 用户视角 | ❌ 只描述代码结构 | ✅ 从用户使用场景出发 |
| 功能清单 | ❌ 无 | ✅ 从 README+代码自动提取 |
| API 文档 | ❌ 无 | ✅ 从路由/handler 自动生成 |
| 部署文档 | ❌ 无 | ✅ 从 Dockerfile/Makefile 生成 |
| FAQ | ❌ 无 | ✅ 从错误处理代码推断 |
| 文档完整性 | ❌ 无 | ✅ 检查 9 类文档，全部补齐 |
| 增量更新 | ❌ 无 | ✅ 只更新变更相关的文档 |

## 核心设计

### 架构

```
ic docs generate
  │
  ├─ 1. 扫描现有文档 (docs/ 目录)
  │     ├─ PRD.md        ✅ 存在 → 跳过
  │     ├─ USER_GUIDE.md ❌ 缺失 → 加入生成队列
  │     └─ ...
  │
  ├─ 2. 构建文档上下文
  │     ├─ 项目概述 (README)
  │     ├─ 功能清单 (从代码中提取 handler/route/api/service)
  │     ├─ 技术栈 (package.json/go.mod)
  │     ├─ 部署方式 (Dockerfile/Makefile)
  │     ├─ API 路由 (扫描 router/handler 文件)
  │     ├─ 配置项 (config/env 文件)
  │     └─ 错误处理 (error 文件)
  │
  ├─ 3. 逐个文档生成 (9 个并行 Agent)
  │     ├─ Agent1 → PRD.md
  │     ├─ Agent2 → USER_GUIDE.md
  │     ├─ Agent3 → API.md
  │     ├─ ...
  │     └─ Agent9 → CONTRIBUTING.md
  │
  └─ 4. 文档索引生成 (docs/README.md)
```

### 9 类文档内容模板

#### PRD.md (产品需求文档)
```
# 产品需求文档
## 产品概述 (从 README 提取)
## 目标用户 (推断)
## 核心功能 (从代码中提取 handler/service)
## 功能优先级 (P0/P1/P2)
## 非功能需求 (性能/安全/可用性)
## 版本规划
```

#### USER_GUIDE.md (用户使用手册)
```
# 用户使用手册
## 快速开始 (从 README 提取)
## 安装部署 (从 Makefile/Dockerfile 提取)
## 功能介绍 (每个功能一个章节)
## 配置说明 (从 config/env 提取)
## 常见问题 (从错误处理代码推断)
```

#### API.md (API 接口文档)
```
# API 接口文档
## 概述
## 认证方式 (从 auth 模块提取)
## 接口列表 (从 router/handler 提取)
  - GET /api/xxx
  - POST /api/yyy
## 请求/响应示例
## 错误码说明
```

#### ARCHITECTURE.md (架构设计文档)
```
# 架构设计文档
## 系统架构图 (ASCII art)
## 技术选型理由
## 模块职责
## 数据流
## 部署架构
## 关键技术决策 (ADR)
```

#### TESTING.md (测试策略)
```
# 测试策略文档
## 测试框架
## 测试分层 (单元/集成/E2E)
## 覆盖率目标
## 运行方式
## CI/CD 集成
```

#### DEPLOYMENT.md (部署运维)
```
# 部署运维手册
## 环境要求
## 部署步骤 (从 Dockerfile/Makefile 提取)
## 配置管理
## 监控告警
## 备份恢复
## 故障处理
```

### 上下文增强

当前 `context.ts` 需要新增 `assembleDocsContext()`：

```typescript
async function assembleDocsContext(index: ProjectIndex): Promise<string> {
  // 1. 扫描 API 路由
  const apiRoutes = extractApiRoutes(index);
  
  // 2. 提取配置项
  const configKeys = extractConfigKeys(index);
  
  // 3. 提取错误处理
  const errorPatterns = extractErrorPatterns(index);
  
  // 4. 提取部署信息
  const deployInfo = extractDeployInfo(index);
  
  // 5. 构建文档上下文
  return formatDocsContext({ apiRoutes, configKeys, errorPatterns, deployInfo });
}
```

### 文档质量标准

生成后自动检查：
- ✅ 每个文档 ≥ 500 字
- ✅ 包含表格（至少 1 个）
- ✅ 包含代码示例（至少 1 个）
- ✅ 包含操作步骤（至少 1 个）
- ✅ 无 "TODO" / "待补充" / "TBD" 占位符
