// Capture raw model output and test parseAIOutput behavior
// Usage: node scripts/capture-raw-output.mjs
import { createProvider } from '../dist/ai/provider.js';
import { parseAIOutput, AIOutputContractError } from '../dist/ai/output-contract.js';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
if (!API_KEY) {
  console.error('DEEPSEEK_API_KEY not set');
  process.exit(1);
}

const SYSTEM_PROMPT = `你是 icloser Agent Shell，终端中的 AI 工程助手。

## 项目信息
- 语言: typescript
- 框架: 无
- 数据库: 无
- 构建: npm
- 测试: vitest

## 回复规则
1. 只输出一个 JSON 代码块，不要输出其他解释
2. JSON 结构必须是：
{
  "summary": "本次修改摘要",
  "changes": [
    {
      "file": "相对路径",
      "operation": "write",
      "content": "完整文件内容",
      "reasoning": "为什么修改这个文件"
    }
  ]
}
3. changes 至少 1 项，file 必须是项目内相对路径，operation 只能是 write
4. content 必须是完整文件内容，不能只给片段或 diff
5. 代码匹配项目的语言/框架/代码风格
6. 中文说明写在 summary/reasoning 中，代码术语保留英文`;

const CONTEXT_CODE = `// File: src/math.ts
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`;

const TASK = '修改 src/math.ts 添加一个 subtract 减法函数';

async function main() {
  const provider = createProvider({
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    apiKey: API_KEY,
    maxTokens: 100000,
    temperature: 0.3,
  });

  console.log('=== Calling DeepSeek Provider ===');
  console.log(`Model: ${provider.defaultModel}`);
  console.log(`Task: ${TASK}\n`);

  const start = Date.now();
  const response = await provider.chat({
    systemPrompt: SYSTEM_PROMPT,
    context: {
      projectMeta: 'TypeScript project with math utilities',
      relevantCode: [{ file: 'src/math.ts', content: CONTEXT_CODE, relevance: 1, compression: 'full' }],
      relevantMemory: '',
      totalTokens: 200,
      budgetUsed: 1,
    },
    task: TASK,
    history: '',
  });
  const duration = Date.now() - start;

  console.log(`Duration: ${duration}ms`);
  console.log(`Tokens: ${response.tokensUsed}`);
  console.log(`Model: ${response.model}`);
  console.log(`Has structuredOutput: ${!!response.structuredOutput}`);
  console.log('');

  // 1. Check if model strictly outputs fenced JSON
  console.log('=== Q1: Does model output fenced JSON? ===');
  const hasFenced = /```(?:json|icloser-ai-output)\s*\n([\s\S]*?)```/gi.test(response.content);
  console.log(hasFenced ? 'YES — contains ```json ... ``` block' : 'NO — no fenced JSON block');

  // 2. Check if model outputs extra text around JSON
  console.log('\n=== Q2: Does model output extra prose around JSON? ===');
  const trimmed = response.content.trim();
  const startsWithBrace = trimmed.startsWith('{');
  const endsWithBrace = trimmed.endsWith('}');
  const startsWithFence = trimmed.startsWith('```');
  const endsWithFence = trimmed.endsWith('```');
  console.log(`Starts with '{': ${startsWithBrace}`);
  console.log(`Ends with '}': ${endsWithBrace}`);
  console.log(`Starts with fence: ${startsWithFence}`);
  console.log(`Ends with fence: ${endsWithFence}`);
  if (!startsWithBrace && !startsWithFence) {
    console.log('HAS EXTRA PROSE before JSON');
  }
  if (!endsWithBrace && !endsWithFence) {
    console.log('HAS EXTRA PROSE after JSON');
  }
  if ((startsWithBrace && endsWithBrace) || (startsWithFence && endsWithFence)) {
    console.log('STRICT: no extra prose detected');
  }

  // 3. Parse and check
  console.log('\n=== Q3: parseAIOutput result ===');
  try {
    const parsed = parseAIOutput(response.content);
    console.log('SUCCESS — parsed AI Output Contract');
    console.log(`  summary: ${parsed.summary}`);
    console.log(`  changes: ${parsed.changes.length}`);
    for (const c of parsed.changes) {
      console.log(`  - ${c.file} (${c.operation}): ${c.content.length} chars, reasoning: ${c.reasoning.substring(0, 80)}`);
    }
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    if (err instanceof AIOutputContractError && err.detail) {
      console.log(`  Detail: ${err.detail}`);
    }
  }

  // 4. Print raw output (truncated for readability)
  console.log('\n=== Raw model output (first 2000 chars) ===');
  console.log(response.content.substring(0, 2000));
  if (response.content.length > 2000) {
    console.log(`\n... (${response.content.length - 2000} more chars)`);
  }
  console.log('\n=== Raw output (last 200 chars) ===');
  console.log(response.content.substring(Math.max(0, response.content.length - 200)));
}

main().catch(err => {
  console.error('FAILED:', err.message);
  if (err.suggestion) console.error('Suggestion:', err.suggestion);
  if (err.raw) console.error('Raw:', err.raw);
  process.exit(1);
});
