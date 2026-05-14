# S2.2 AI Output Contract

日期：2026-05-13
负责人：dev2
状态：完成

## 目标

把 AI 输出从自由文本 / legacy `write:` 代码块收敛为稳定结构，降低真实 Provider 任务链写文件失败率。

## 本次变更

- `src/ai/output-contract.ts`
  - 新增 AI 输出协议类型和解析/校验 helper。
  - 支持 fenced JSON、裸 JSON。
  - 保留 legacy `write:路径` 兼容解析。
  - 拒绝空变更、空内容、绝对路径、`..` 越界路径、不支持的 operation。
- `src/types.ts`
  - `AIResponse` 新增可选 `structuredOutput`。
- `src/ai/provider.ts`
  - mock provider 改为输出 AI Output Contract JSON。
  - mock response 同时携带 `structuredOutput`。
- `src/index.ts`
  - task 主链优先消费 `response.structuredOutput`。
  - 真实 Provider 返回文本时走 `parseAIOutput(response.content)`。
  - 自动修复链路同样走 `parseAIOutput()`。
  - 系统提示词改为要求输出 JSON contract。
- `tests/ai-output-contract.test.ts`
  - 新增 7 个协议测试。
- `tests/provider.test.ts`
  - mock provider 断言改为结构化输出。
- `doc/ARCHITECTURE.md`
  - 增加 AI Output Contract 架构说明。
- `doc/DEVELOPMENT.md`
  - 增加 S2.2 开发记录。

## AI Output Contract

```json
{
  "summary": "本次修改摘要",
  "changes": [
    {
      "file": "src/example.ts",
      "operation": "write",
      "content": "完整文件内容",
      "reasoning": "为什么修改这个文件"
    }
  ]
}
```

## 验收标准

- `npm run build` 通过。
- `npm run test` 通过。
- `npm run smoke` 通过。
- mock task 仍能修改 `notes.txt`。
- 非法 AI 输出不会写文件。
- JSON/stdout 契约测试不退化。

## 当前验收

- `npm run build` 通过。
- `npm run test` 通过：12 个测试文件，99 个测试。
- `npm run smoke` 通过。
- smoke 中 mock provider 使用结构化输出完成 `notes.txt` 修改。
- `ic gate --json` passed = true。
- S2.4/S2.5 后测试基线为 12 个测试文件，101 个测试。

## 后续风险

- REPL 仍保留 legacy `write:` 解析，尚未纳入本次结构化协议迁移。
- 当前 operation 只支持 `write`，后续如需 patch/delete/rename 需要扩展协议和安全校验。
- S2.4 已增强解析器：真实 Provider 如果在 JSON 前后输出解释文本，解析器会扫描合法 JSON contract；没有合法 JSON 时仍会拒绝写入。
