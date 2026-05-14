# S2.5 REPL Output Contract Migration

日期：2026-05-13
负责人：dev2
状态：完成

## 目标

将 REPL 的文件输出协议迁移到 AI Output Contract，保持与 task 主链一致，同时保留 legacy `write:` 兼容路径。

## 本次变更

- `src/cli/repl.ts`
  - 引入 `parseAIOutput()`。
  - REPL system prompt 改为要求 JSON contract。
  - `/test` 生成命令改为要求 JSON contract。
  - `extractFileBlocks()` 优先解析 AI Output Contract。
  - 如果解析失败，再回退 legacy `write:` 正则解析。
- `doc/ARCHITECTURE.md`
  - 更新 REPL 数据流说明。
- `doc/DEVELOPMENT.md`
  - 新增 S2.5 记录。

## 验收标准

- `npm run build` 通过。
- `npm run test` 通过。
- `npm run smoke` 通过。
- `npm run smoke:project` 通过。
- REPL 仍保留 legacy `write:` 兼容。
- REPL 新提示词与 task 主链使用同一 AI Output Contract。

## 当前验收

- `npm run build` 通过。
- `npm run test` 通过：12 个测试文件，101 个测试。
- `npm run smoke:project` 通过。
- `npm run smoke` 通过。
- REPL 已优先使用 `parseAIOutput()`，legacy `write:` 保留兜底。

## 给 dev1 的提示词

```text
dev2 已完成 S2.5 REPL Output Contract Migration。

后续你做真实 Provider 或交互体验验证时，请注意：
1. task 主链和 REPL 现在都要求 AI Output Contract JSON。
2. REPL 仍保留 legacy write: 兜底兼容，但新提示词不再要求 write:。
3. 如果真实 Provider 在 REPL 中输出不合规，请记录模型原始输出和 parseAIOutput 错误。
4. 不要新增第三套输出协议。

验收关注：
- npm run build
- npm run test
- npm run smoke
- npm run smoke:project
- 手动 REPL 可选验证：输入一个修改文件请求，确认能识别 pending files。
```
