# AI 文档操作能力设计

## 核心思路

从 "生成文档" 升级为 "对话式文档工作台" — AI 不只是写文档，而是理解、回答、改写、审查文档。

```
传统：ic docs generate → 生成 9 个文档 → 结束
升级：ic docs ask "JWT 怎么配置？" → AI 读遍所有文档 → 精准回答
```

## 12 项能力清单

### D1. 文档问答 (RAG over docs)
```
ic docs ask "JWT 认证怎么实现的？"
  → AI 读取 PRD/API/ARCHITECTURE 等所有文档
  → 找到相关段落
  → 用自然语言回答
  → 附带信息来源（哪个文档、哪一行）
```

### D2. 文档摘要
```
ic docs summarize API.md
  → AI 读取 → 输出 3 句话摘要 + 关键接口列表
ic docs summarize --all
  → 所有文档各一段摘要
```

### D3. 跨文档关联问答
```
ic docs relate "PRD的用户管理功能"
  → AI 扫描所有文档
  → 找到 PRD 中的用户管理描述
  → 关联 API.md 中的 /user/* 接口
  → 关联 ARCHITECTURE.md 中的 auth middleware
  → 输出关联视图
```

### D4. 上下文翻译
```
ic docs translate API.md --lang en
  → AI 读取文档，保持技术术语准确性
  → 输出 API.en.md
ic docs translate --lang ja
  → 批量翻译所有文档
```

### D5. 格式转换
```
ic docs convert ARCHITECTURE.md --to mermaid
  → AI 读取架构文档
  → 输出 Mermaid 格式的架构图
ic docs convert --to pdf
  → Markdown → PDF
```

### D6. 文档拆分/合并
```
ic docs split PRD.md --by heading
  → 按 ## 标题拆分为独立文件
  → docs/PRD/01-概述.md, 02-功能.md, ...
ic docs merge docs/PRD/*.md --output PRD-完整版.md
```

### D7. Git → CHANGELOG
```
ic docs changelog --from-git
  → 读取 git log (最近 50 条)
  → AI 分类：feat/fix/breaking
  → 生成结构化 CHANGELOG.md
```

### D8. 角色改写
```
ic docs rewrite API.md --for beginner
  → AI 把 API 文档改写成新手指南
  → 去掉技术细节，加使用示例
ic docs rewrite API.md --for architect
  → 突出架构决策和设计理由
```

### D9. 文档审查
```
ic docs review PRD.md
  → AI 审查文档质量
  → 标注：不明确的地方、矛盾之处、缺失信息
  → 输出审查报告（行号 + 问题 + 建议）
```

### D10. 交互式 QA
```
ic docs chat
  → 进入文档对话模式
  → ◇ 这个项目怎么部署？
  → ◆ AI：从 DEPLOYMENT.md 中找到...
  → ◇ 需要什么环境变量？
  → ◆ AI：从 .env 和 config 中找到...
  → /exit 退出
```

### D11. 文档大纲
```
ic docs outline PRD.md
  → AI 读取 → 输出大纲树
  → ## 产品概述
  →   ### 项目背景
  →   ### 目标用户
  → ## 核心功能
  →   ### 用户管理
  →   ### 权限控制
```

### D12. 智能链接建议
```
ic docs suggest-links
  → AI 扫描所有文档
  → 发现 "用户认证" 出现在 PRD/API/ARCHITECTURE 中
  → 建议在这些文档间添加交叉引用
  → 输出：PRD.md L45 → API.md L12 (用户认证)
```

## 实现架构

```
ic docs ask|summarize|translate|review|...
  │
  ├─ 1. 读取文档 (docs/ + root *.md)
  ├─ 2. 构建文档索引 (段落级)
  ├─ 3. AI 分析 (一次性 prompt，含所有文档上下文)
  └─ 4. 输出结果 (终端 + 可选写入文件)
```

## 优先级

| 优先级 | 能力 | 复杂度 | 说明 |
|--------|------|--------|------|
| 🔴 P0 | D1 文档问答 | 中 | `ic docs ask` — 最核心的 AI 文档操作 |
| 🔴 P0 | D2 文档摘要 | 低 | `ic docs summarize` |
| 🟡 P1 | D8 角色改写 | 低 | `ic docs rewrite` |
| 🟡 P1 | D9 文档审查 | 中 | `ic docs review` |
| 🟡 P1 | D7 Git→CHANGELOG | 低 | `ic docs changelog --from-git` |
| 🟢 P2 | D3 跨文档关联 | 中 | `ic docs relate` |
| 🟢 P2 | D4 上下文翻译 | 中 | `ic docs translate` |
| 🟢 P2 | D10 交互式QA | 高 | `ic docs chat` |
| 🟢 P3 | D5 格式转换 | 中 | `ic docs convert` |
| 🟢 P3 | D6 拆分合并 | 低 | `ic docs split/merge` |
| 🟢 P3 | D11 文档大纲 | 低 | `ic docs outline` |
| 🟢 P3 | D12 智能链接 | 低 | `ic docs suggest-links` |
