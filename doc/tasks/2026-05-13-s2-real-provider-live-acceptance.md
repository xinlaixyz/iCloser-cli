# S2.3 Real Provider Live Acceptance（含 S2.4 Parser Hardening 验证）

日期：2026-05-13
负责人：dev1
状态：完成
覆盖：S2.1 + S2.2 + S2.4 integration 真实 Provider 实测

## 目标

用真实 Provider（DeepSeek）在最小 TypeScript 项目中，完成完整 task --go 闭环，并验证 S2.4 AI Output Parser Hardening 在实际模型输出上的表现。

## 使用的 Provider

| 项目 | 值 |
|------|-----|
| Provider | deepseek |
| Model | deepseek-v4-pro |
| API Key 配置方式 | 环境变量 `$env:DEEPSEEK_API_KEY`（测试用） |

## 实测命令列表

```powershell
# === 基线 ===
npm run build                        # 通过
npm run test                         # 12 文件, 101 测试
npm run smoke                        # PASS (mock)
npm run smoke:project                # PASS (mock, TypeScript)

# === 真实 Provider 连通性 ===
$env:DEEPSEEK_API_KEY = "sk-xxx"
ic provider use deepseek
ic provider test --json              # → ok=true, 43 tokens, ~2.9s

# === 项目初始化 ===
ic init --force                      # → language=typescript
ic doctor --strict --json            # → ready=true

# === 任务执行（Task 1: subtract） ===
ic t "修改 src/math.ts 添加一个 subtract 减法函数" --go
# → task-mp3hgq2r-6b9no, completed, 558 tokens, ~11s

# === 任务执行（Task 2: divide, 独立复验） ===
ic t "修改 src/math.ts 添加一个 divide 除法函数" --go
# → task-mp3i0ti3-06ein, completed, 591 tokens, ~17s

# === 门禁 ===
ic gate task-mp3i0ti3-06ein --json   # → passed=true, blockingCount=0
ic report                            # → 报告完整

# === 原始输出分析 ===
node scripts/capture-raw-output.mjs        # 严格 prompt → bare JSON
node scripts/test-relaxed-prompt.mjs       # 宽松 prompt → bare JSON, operation=modify 被拒
node scripts/test-prose-fallback.mjs       # prose 允许 → 仍 bare JSON
```

## S2.4 四项记录

### 1. 模型是否严格输出 fenced JSON？

**否。** DeepSeek (deepseek-v4-pro) 在三种不同 prompt 条件下（严格、宽松、prose 允许）均输出 **bare JSON**（以 `{` 开头，以 `}` 结尾），不使用 ` ```json ... ``` ` fence。

| 测试 | Prompt | 输出格式 |
|------|--------|---------|
| capture-raw-output | 严格（"只输出一个 JSON 代码块"） | bare JSON |
| test-relaxed-prompt | 宽松（"用 JSON 格式输出"） | bare JSON |
| test-prose-fallback | prose 允许（"先简短解释再给 JSON"） | bare JSON |

### 2. 是否输出了 JSON 前后解释文字？

**否。** 三次测试均无 prose。模型输出从头到尾是纯 JSON object。

### 3. parseAIOutput 是否成功？

**生产路径（严格 prompt）— 成功。**

`parseJsonContract()` 的 bare JSON 路径匹配（`startsWith('{') && endsWith('}')`），直接 `JSON.parse`，合法 contract。

**宽松 prompt 路径 — 失败（预期行为）。**

当 prompt 不强调 `operation: "write"` 时，模型可能输出 `operation: "modify"`：
```
错误：changes[0] operation 仅支持 write
```

这是 `validateAIOutputContract()` 的正确拦截。模型输出本身是合法 JSON，但 `operation` 字段值不在允许集合中。

**prose 允许 prompt — 成功。**

模型仍输出 bare JSON（无 prose 包裹），parser 通过 bare JSON 路径成功解析。

### 4. 失败时的错误信息和模型输出片段

**失败场景：operation=modify**

```
=== 模型输出 ===
{
  "summary": "在 src/util.ts 中添加 farewell 函数，提供告别功能",
  "changes": [
    {
      "file": "src/util.ts",
      "operation": "modify",
      "content": "export function greet(name: string): string { ... }\n\nexport function farewell(name: string): string { return \"Goodbye, \" + name; }",
      "reasoning": "原文件只有 greet 函数，添加 farewell 函数可以对称地提供告别功能。"
    }
  ]
}

=== 错误 ===
AIOutputContractError: changes[0] operation 仅支持 write
```

**结论：** 当前生产 prompt 已明确要求 `operation: write`，模型遵从。宽松 prompt 下模型可能使用其他 operation 名，parser 正确拦截。不修改 contract 宽度，保持 `write` 为唯一合法 operation。

## 真实任务执行结果（2 次独立验证）

### Task 1: subtract

- ID: `task-mp3hgq2r-6b9no`
- Provider: deepseek, 558 tokens, ~11s
- 文件: `src/math.ts` — 新增 `subtract` 函数
- 验证: compile/lint/unit-test 全部通过

### Task 2: divide

- ID: `task-mp3i0ti3-06ein`
- Provider: deepseek, 591 tokens, ~17s
- 文件: `src/math.ts` — 新增 `divide` 函数（含除零守卫）
- 验证: compile/lint/unit-test 全部通过

```typescript
// 模型实际输出（含除零守卫）
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero is not allowed.');
  }
  return a / b;
}
```

## Gate JSON 结果（Task 2）

```json
{
  "passed": true,
  "blockingCount": 0,
  "checks": [
    { "name": "测试门禁", "status": "pass" },
    { "name": "安全门禁", "status": "pass" },
    { "name": "推理门禁", "status": "pass" },
    { "name": "报告门禁", "status": "pass" },
    { "name": "回滚门禁", "status": "warn" },
    { "name": "Git 门禁", "status": "warn" }
  ]
}
```

## 基线验收

| 检查项 | 结果 |
|--------|------|
| `npm run build` | 通过 |
| `npm run test` | 12 文件, 101 测试通过 |
| `npm run smoke` | PASS（mock provider） |
| `npm run smoke:project` | PASS（mock provider, TypeScript） |
| `ic provider test` (deepseek) | ok=true, 43-62 tokens, ~3-5s |
| `ic doctor --strict --json` | ready=true |
| `ic t "..." --go` × 2 (deepseek) | 均 completed, verify=pass |
| `ic gate --json` | passed=true, blockingCount=0 |

## 失败或风险列表

### 本次无阻塞失败

两次独立任务执行均成功：
- Provider 连通正常（~3-5s）
- AI 输出 bare JSON，parseAIOutput 成功
- 文件写入正确，code style 一致
- 验证全通过

### 已知风险

1. **模型名称**：`deepseek-v4-pro` 为特定部署 ID。公开 API 用户需 `deepseek-chat`。
2. **Bare JSON 依赖**：当前依赖 bare JSON 路径解析。如果未来模型在 JSON 前后加 markdown 解释文字，需 S2.4 的 `findJsonObjectCandidates()` fallback。（该 fallback 已在单元测试覆盖，但真实模型暂未触发。）
3. **operation 枚举**：当前仅支持 `write`。宽松 prompt 下模型可能输出 `modify`/`update`，parser 正确拒绝。这是设计决策，不视为 bug。
4. **API Key 存储**：生产环境应优先使用环境变量而非项目 config 明文。
5. **单次简单任务**：复杂重构可能触发不同边界。
6. **其他 Provider**：仅验证 DeepSeek。OpenAI/Claude/Qwen 格式差异未测。

## 结论

S2.1 (Real Provider Task Chain) + S2.2 (AI Output Contract) + S2.4 (Parser Hardening) 的 integration 已通过真实 DeepSeek Provider 在最小 TypeScript 项目中的 live acceptance。

关键发现：
- DeepSeek 稳定输出 bare JSON（无 fence，无 prose）
- 严格 prompt 下 `operation: write` 遵从率 100%
- S2.4 `findJsonObjectCandidates()` 虽未被真实触发，但单元测试覆盖，可应对未来模型输出 prose 的场景
- 任务主链从 mock 到真实 Provider 切换只需 `ic provider use <name>` + API Key

下一步：dev2 做 S2 集成验收（见 `doc/S2_DEVELOPMENT_PLAN.md`）。
