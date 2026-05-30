# 文档管理系统设计方案

## 当前能力

| 功能 | 状态 |
|------|------|
| 文档缺口检测 | ✅ `ic docs status` |
| 文档生成 | ✅ `ic docs generate` |
| 质量检查 | ✅ `ic docs check` |

## 缺失能力清单（13 项）

### 1. AI 文档修改（增量编辑）
**场景**：PM 说 "在 PRD.md 里加一个用户权限管理的需求"，AI 只改相关段落不改全文。

```
ic docs edit PRD --prompt "添加用户权限管理需求"
  → AI 读取 PRD.md → 定位插入位置 → 只修改相关段落 → 保留其余内容
```

### 2. 可视化 Diff 展示（终端颜色）
**场景**：修改前后对比，终端显示红色删除行 + 绿色新增行。

```
ic docs diff PRD
  →  ─ src/docs/PRD.md ─
     1   # 产品需求文档
     2 + ## 新增：用户权限管理      ← 绿色
     3   ## 核心功能
     4 - ## 旧功能：已废弃           ← 红色
```

已有关键基础设施：`src/core/diff-renderer.ts` 已有 ANSI diff 渲染，`cli/output.ts` 已有 `ICONS` 颜色系统。

### 3. 文档版本历史
**场景**：文档每次修改自动保存快照，可回退到任意历史版本。

```
ic docs history PRD           # 列出所有版本
ic docs rollback PRD --v3     # 回退到 v3
ic docs diff PRD --v2 --v3    # 对比两个版本
```

存储：`.icloser/docs-snapshots/PRD.md.v1`, `.v2`, ...

### 4. 章节级管理
**场景**：只重新生成文档的某个章节，不改其他部分。

```
ic docs section PRD --heading "核心功能" --regenerate
ic docs section API --heading "认证方式" --edit "增加 OAuth2 说明"
```

### 5. 文档间交叉引用
**场景**：PRD 中的功能自动链接到 API 文档的具体接口。

```
ic docs link                 # 扫描所有文档，建立内部链接索引
ic docs check-links          # 验证所有内部链接有效
```

### 6. 多语言文档
**场景**：生成中英文双语文档。

```
ic docs translate PRD --lang en     # 翻译 PRD → PRD.en.md
ic docs translate --all --lang ja   # 全部翻译为日语
```

### 7. 文档导出
**场景**：生成 PDF / HTML / 静态站点。

```
ic docs export --format pdf   # 导出为 PDF
ic docs export --format html  # 导出为静态 HTML 站点
```

### 8. 审核工作流
**场景**：文档修改需要人工确认后才能合入。

```
ic docs propose PRD           # AI 生成修改提案
ic docs review PRD            # 查看 diff，确认/拒绝
ic docs approve PRD           # 合入修改
ic docs reject PRD --reason "需求不合理"
```

### 9. 全文搜索
**场景**：在所有文档中搜索关键词。

```
ic docs search "JWT 认证"     # 搜索所有文档
ic docs search "API" --in PRD # 限定文档范围
```

### 10. 代码变更 → 文档自动更新
**场景**：API 路由变了，自动更新 API.md；新增模块，自动更新 ARCHITECTURE.md。

```
# 自动触发（代码变更后）
ic docs sync                  # 检测代码变更 → 更新受影响的文档
ic docs sync --dry-run        # 预览将要更新的内容
```

依赖：增量扫描 fingerprints 已有，可检测哪些文件变了。

### 11. 目录自动生成
**场景**：长文档自动生成可跳转的目录。

```
ic docs toc PRD               # 为 PRD.md 生成目录
ic docs toc --all             # 所有文档生成目录
```

### 12. 文档一致性检查
**场景**：PRD 里列了 15 个功能，但 API.md 只文档化了 10 个 → 报告不一致。

```
ic docs check-consistency     # 交叉验证文档间一致性
  → ⚠️ PRD 列出 "用户导出" 但 API.md 无对应接口
  → ⚠️ ARCHITECTURE.md 提到 Redis 但 DEPLOYMENT.md 未说明 Redis 部署
```

### 13. 文档模板系统
**场景**：团队自定义文档模板（替换默认 9 类）。

```
ic docs template create mobile-app   # 创建自定义模板
ic docs generate --template mobile-app  # 使用自定义模板生成
```

## 实现优先级

| 优先级 | 功能 | 用户价值 | 复杂度 | 依赖 |
|--------|------|---------|--------|------|
| 🔴 P0 | #2 可视化 Diff | 最高 | 低 | diff-renderer.ts 已有 |
| 🔴 P0 | #1 AI 增量编辑 | 最高 | 中 | 需章节定位逻辑 |
| 🟡 P1 | #4 章节级管理 | 高 | 中 | #1 的基础 |
| 🟡 P1 | #10 代码→文档同步 | 高 | 中 | 增量扫描已有 |
| 🟡 P1 | #3 版本历史 | 中 | 中 | 快照存储 |
| 🟢 P2 | #12 一致性检查 | 中 | 低 | 规则引擎 |
| 🟢 P2 | #11 目录生成 | 中 | 低 | Markdown 解析 |
| 🟢 P2 | #9 全文搜索 | 中 | 低 | 复用 ripgrep |
| 🟢 P3 | #5 交叉引用 | 低 | 高 | 需要文档解析器 |
| 🟢 P3 | #6 多语言 | 低 | 中 | AI 翻译 |
| 🟢 P3 | #7 导出 | 低 | 中 | 外部工具 |
| 🟢 P3 | #8 审核流 | 低 | 中 | 状态管理 |
| 🟢 P3 | #13 模板系统 | 低 | 中 | 自定义模板 |

## 本次实现范围建议

P0（必须）：#1 AI 增量编辑 + #2 可视化 Diff
P1（重要）：#3 版本历史 + #4 章节管理 + #10 代码同步

这样 `ic docs` 就从一个"生成器"升级为完整的"文档生命周期管理器"。
