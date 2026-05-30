# 架构师验收：代码能力提升

日期：2026-05-21  
验收对象：工程师提交的代码能力增强，包括 AI 测试生成、代码审查、AST/数据流增强、工具执行补强与 Web 搜索缓存。

## 验收结论

**结论：修复补漏后通过。**

工程师提交的主体能力基本成立，但初次全量验收并非“零回归”：`src/core/doc-reader.ts` 存在 `pdfParse` 重复声明，导致 `tests/doc-reader.test.ts` 与 `tests/doc-reader-coverage.test.ts` 在 Vitest/esbuild 阶段直接加载失败。架构师已补齐该漏洞，并额外修复 `web_search` 工具入口未传递 `rootPath` 的项目级缓存落点问题。

## 架构师补漏

| 问题 | 影响 | 修复 |
|------|------|------|
| `web_search` 未把 `rootPath` 传入 `searchWeb()` | 文档宣称的 `.icloser/web-cache.json` 项目级缓存没有完整接到工具执行主链路 | `executeToolCall('web_search')` 改为调用 `searchWeb(query, { maxResults: 3, rootPath })` |
| `doc-reader.ts` 重复声明 `pdfParse` | 全量测试中两个 doc-reader 套件加载失败 | 去掉重复声明，保留“先拦截 PDF 噪音再加载解析器”的路径 |
| `read_pdf` 工具残留 PDF parser stderr 警告 | 工具输出观感不干净，影响 T4 工具结果展示验收 | `tool-executor.ts` 增加 `suppressPdfParserNoise()`，包住 PDFParse `load/getText` |
| 缺少 web_search rootPath 回归测试 | 后续容易再次断开项目缓存链路 | 新增 `tests/tool-executor-web-search-root.test.ts` |

## 验收命令

```bash
npx tsc --noEmit
npm run lint
npm test
npx vitest run tests/tool-executor-web-search-root.test.ts tests/tool-executor.test.ts tests/tool-executor-extra.test.ts tests/code-writer.test.ts tests/code-writer-extra.test.ts tests/code-writer-enforce.test.ts tests/autotest-extra.test.ts tests/ts-dataflow-coverage.test.ts tests/ast-parser-impact.test.ts
npx vitest run tests/doc-reader.test.ts tests/doc-reader-coverage.test.ts tests/tool-executor-extra.test.ts
```

## 验收结果

| 项目 | 结果 |
|------|------|
| TypeScript | `npx tsc --noEmit` 通过 |
| Lint | `npm run lint` 通过，`custom lint ok`，`eslint ok` |
| 全量测试 | `120 passed` test files，`1731 passed / 2 skipped` tests |
| 代码能力定向测试 | 9 个测试文件，171 条通过 |
| 文档/PDF/工具补漏测试 | 3 个测试文件，104 条通过，PDF parser 警告已消除 |

## 本轮复验追加补漏

| 问题 | 影响 | 修复 |
|------|------|------|
| `collab audit --json` 无任务记录时混入人类提示 | JSON 消费方无法稳定 `JSON.parse` | json 模式先输出 envelope 并返回 |
| `impact --json` 未扫描项目时只输出 warning | CI/IDE 无法解析失败状态 | 返回 `project-not-scanned` JSON error envelope，退出码置 1 |
| `provider doctor --json` 在未初始化项目输出文本错误 | 首次使用/CI 下 JSON 契约不完整 | provider 命令统一解析 `--json`，兼容前后位置，并返回 `provider-error` envelope |
| `ic search` 使用无效 `rg --type-not binary` | Windows/macOS ripgrep 版本不兼容时搜索静默失败 | 移除无效 type 参数，保留 node_modules/.git/dist glob 排除 |

## 能力判断

| 能力 | 验收判断 |
|------|----------|
| AI 代码生成 | 可验收：已有生成、解析、质量门禁、verify loop 与 mock AI 验收；真实 Provider 黄金路径仍需补 |
| AI 自动测试 | 可验收：T10 路径有单测支撑，覆盖行为断言与验证修复回路；Go/Python/Java 的真实生成仍待扩大 |
| AST/代码智能 | 可验收：C/C++/Rust 解析、Go/Python 数据流、TS type checker 路径均有定向测试 |
| 工具执行 | 修复后可验收：工具链路、危险命令拦截、dry-run、PDF 噪音控制、web_search 项目缓存均进入测试 |
| 测试能力 | 可验收：全量 1715 条通过；但 lint warning 数量仍高，不能宣称“无警告” |
| 市场定位 | 阶段性可验收：已具备“本地工程执行器 + Claude Code 替代品 + 长期记忆”的骨架；发布前必须补真实项目黄金路径 |

## 仍未完成

| 优先级 | 事项 | 下一步 |
|--------|------|--------|
| P0 | 真实 Provider 代码交付黄金路径不足 | 固定 demo 仓库跑通 scan -> plan -> code -> diff -> verify -> repair -> report -> rollback/commit |
| P1 | lint warnings 仍有 158 个 | 分批清理未使用变量、`any`、测试噪音，不阻塞本次验收但阻塞发布信任感 |
| P1 | 验证管线 T9 并行化未落地 | 先并行 compile/lint，coverage/e2e 保持串行 |
| P1 | macOS 实机/CI 顺畅度待复验 | 在 `macos-latest` 或真实 macOS 跑 build/tsc/lint/test/smoke/smoke:tools |
| P2 | REPL 仍需继续拆分 | T8 下一步拆 `repl-chat.ts`、memory display、chat handler |
