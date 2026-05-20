# AI 全系统操作能力 — 完整开发计划

日期：2026-05-15
状态：待开发

## 一、代码编写增强 (P0: C1, C3, C6)

### #82 C1: 上下文感知代码生成
**目标**：AI 写新代码前自动读取现有代码模式（路由/controller/model）
**实现**：
- `src/core/code-writer.ts` — `readCodePatterns()` 分析现有代码风格
- 增强 `buildSystemPrompt` — 注入检测到的代码模式
- CLI: `ic code new <描述>` 命令
**测试**：`tests/code-writer.test.ts`

### #83 C3: 风格匹配
**目标**：AI 自动匹配项目 StyleFingerprint（命名/缩进/引号/分号/错误处理）
**实现**：
- 增强 StyleFingerprint 提取（已有 `src/core/scanner.ts`）
- 注入 AI prompt 作为"代码风格约束"
**测试**：集成到现有检测

### #84 C6: 错误驱动修复
**目标**：`ic code fix` — 读编译/测试错误 → 定位行号 → 只改出错行
**实现**：
- `ic code fix` CLI 命令
- 读取上次验证失败输出 → AI 定位 → 精确修复
**测试**：`tests/code-fix.test.ts`

---

## 二、DevOps 自然语言增强 (P0: E1-E6)

### #85 E1-E6: DevOps 语音控制
**目标**：自然语言控制启动/停止/重启/测试/构建
**实现**：
- 增强 `classifyIntentRegex` — 新增 devops 域匹配
- `isStartProjectIntent` 已有 → 扩展 `isStopIntent`, `isRestartIntent`, `isTestIntent`, `isBuildIntent`
- 每个意图路由到对应 CLI 命令
**测试**：集成到 `tests/intent-classifier.test.ts`

---

## 三、文档 AI 操作 (P0+P1: D1, D2, D7, D8, D9)

### #86 D1: 文档问答
**目标**：`ic docs ask "JWT怎么配置？"` → AI 从所有文档中回答
**实现**：
- `docs-generator.ts` — `askDocumentQuestion()` 函数
- 读取所有 docs/ 文件 → 拼接 context → AI 回答
- 附带信息来源（哪个文档的行号范围）
**测试**：`tests/docs-ask.test.ts`

### #87 D2+D8+D9: 摘要+改写+审查
**目标**：`ic docs summarize|rewrite|review`
**实现**：
- `summarizeDocument()` / `rewriteDocument()` / `reviewDocument()`
- 三个命令共用一个 AI 调用模式（不同 prompt）
**测试**：集成测试

### #88 D7: Git→CHANGELOG
**目标**：`ic docs changelog --from-git` → git log → AI 分类 → CHANGELOG.md
**实现**：
- `docs-generator.ts` — `generateChangelogFromGit()`
- 读取 git log → AI 分类 feat/fix/breaking → 写入
**测试**：`tests/docs-changelog.test.ts`

---

## 四、代码补齐增强 (P1: C2, C4, C5)

### #89 C2: 智能代码补齐
**目标**：`ic code complete src/auth.ts` → 找到未完成函数 → AI 补全
**实现**：
- `code-writer.ts` — `completeFile()` 检测 `// TODO` / 空函数体 / `throw new Error('Not implemented')`
- AI 读上下文 → 补全 → diff
**测试**：`tests/code-complete.test.ts`

### #90 C4: 测试同生成
**目标**：`ic code new <描述> --with-tests` → 代码+测试一起生成
**实现**：
- `code-writer.ts` — `generateWithTests()` 并行生成源码和测试
- 生成后立即运行测试验证
**测试**：集成测试

### #91 C5: 多文件关联修改
**目标**：`ic code refactor "把UserID从int改成string"` → 自动修改所有引用
**实现**：
- `code-writer.ts` — `refactorAcrossFiles()` 
- search_code 找到所有引用 → AI 生成所有修改 → 批量 diff → 确认
**测试**：`tests/code-refactor.test.ts`

---

## 五、PM 自然语言 (P1: I1-I6)

### #92 I1-I6: PM 语音控制
**目标**：自然语言查询发布状态/路线图/风险/估算
**实现**：
- 增强 `classifyIntentRegex` — PM 域匹配
- "能发布吗"→release-status, "进度怎么样"→roadmap, "有什么风险"→risk, "评估这个"→estimate
**测试**：集成到意图分类器

---

## 六、P2-P3 剩余项

### #93 D3+D4+D10+D11+D12: 文档高级操作
跨文档关联、翻译、交互式QA、大纲、智能链接

### #94 C7+C8+C9: 增量构建+解释+脚手架
分步代码生成、带解释的代码输出、模板脚手架

### #95 F+G+H: 代码智能+Agent+记忆自然语言
代码智能查询、Agent编排、记忆操作的自然语言接口

### #96 C10+C11+C12+D5+D6: 安全重构+迁移+补全+格式转换+拆分合并

---

## 总览

| 批 | 任务 | 内容 | 优先级 |
|----|------|------|--------|
| P0-1 | #82 C1 | 上下文感知代码生成 | 🔴 |
| P0-2 | #83 C3 | 风格匹配注入 | 🔴 |
| P0-3 | #84 C6 | 错误驱动修复 | 🔴 |
| P0-4 | #85 E1-E6 | DevOps语音控制 | 🔴 |
| P0-5 | #86 D1 | 文档问答 | 🔴 |
| P0-6 | #87 D2+D8+D9 | 摘要+改写+审查 | 🟡 |
| P0-7 | #88 D7 | Git→CHANGELOG | 🟡 |
| P1-1 | #89 C2 | 智能代码补齐 | 🟡 |
| P1-2 | #90 C4 | 测试同生成 | 🟡 |
| P1-3 | #91 C5 | 多文件关联修改 | 🟡 |
| P1-4 | #92 I1-I6 | PM语音控制 | 🟡 |
| P2 | #93 | 文档高级(D3-5,D10-12) | 🟢 |
| P2 | #94 | 增量+解释+脚手架(C7-9) | 🟢 |
| P2 | #95 | 代码+Agent+记忆(F,G,H) | 🟢 |
| P3 | #96 | 安全重构+迁移+其他 | ⚪ |
