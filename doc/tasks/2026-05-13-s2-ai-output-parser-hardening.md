# S2.4 AI Output Parser Hardening

日期：2026-05-13
负责人：dev2
状态：完成

## 目标

提升真实 Provider 输出兼容性。真实模型即使被要求只输出 JSON，也可能在 JSON 前后附加解释文字；本任务让 `parseAIOutput()` 能从普通文本中提取合法 AI Output Contract，同时仍拒绝非法输出和越界路径。

## 本次变更

- `src/ai/output-contract.ts`
  - 新增 JSON object candidate 扫描。
  - 支持从普通文本中提取第一个包含 `changes` 的 JSON object。
  - 仍然只接受能通过 `validateAIOutputContract()` 的对象。
- `tests/ai-output-contract.test.ts`
  - 新增“prose 包裹 JSON contract”测试。
  - 新增“忽略无关 JSON，解析合法 contract candidate”测试。

## 验收标准

- `npm run build` 通过。
- `npm run test` 通过。
- `npm run smoke` 通过。
- `npm run smoke:project` 通过。
- 普通文本仍拒绝写入。
- 路径越界/绝对路径仍拒绝。

## 当前验收

- `npm run build` 通过。
- `npm run test` 通过：12 个测试文件，101 个测试。
- `npm run smoke:project` 通过。
- `npm run smoke` 通过。
- 新增 parser 测试覆盖：
  - prose 包裹 JSON contract。
  - 忽略无关 JSON，解析后续合法 contract。

## 给 dev1 的补充提示词

```text
补充说明：dev2 已做 S2.4 AI Output Parser Hardening。

真实 Provider live acceptance 时，如果模型在 JSON 前后输出解释文字，不一定会失败：
- parseAIOutput() 现在能从普通文本中扫描并提取合法 AI Output Contract JSON object。
- 但仍然要求对象包含 changes 数组，且 file/operation/content/reasoning 全部合法。
- 路径越界、绝对路径、不支持 operation 仍会拒绝写入。

你实测真实 Provider 时，请记录：
1. 模型是否严格输出 fenced JSON；
2. 是否输出了 JSON 前后解释文字；
3. parseAIOutput 是否成功；
4. 如果失败，把错误信息和模型输出片段贴回给我。
```
