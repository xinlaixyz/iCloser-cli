// Test findJsonObjectCandidates() fallback: allow prose + JSON
import { createProvider } from '../dist/ai/provider.js';
import { parseAIOutput, AIOutputContractError } from '../dist/ai/output-contract.js';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
if (!API_KEY) { console.error('DEEPSEEK_API_KEY not set'); process.exit(1); }

const PROSE_ALLOWED_PROMPT = `你是代码助手。收到任务后，先简短解释方案（1-2句中文），然后用 JSON 格式给出修改详情。
JSON 结构：{ "summary": "...", "changes": [{ "file": "...", "operation": "write", "content": "...", "reasoning": "..." }] }
operation 只能是 write。`;

const provider = createProvider({
  provider: 'deepseek', model: 'deepseek-v4-pro',
  apiKey: API_KEY, maxTokens: 100000, temperature: 0.3,
});

console.log('=== PROSE FALLBACK TEST: Prompt that allows prose ===\n');

const resp = await provider.chat({
  systemPrompt: PROSE_ALLOWED_PROMPT,
  context: {
    projectMeta: 'TypeScript project', totalTokens: 0, budgetUsed: 0,
    relevantCode: [{
      file: 'src/calc.ts',
      content: 'export function square(x: number): number { return x * x; }\n',
      relevance: 1, compression: 'full',
    }],
    relevantMemory: '',
  },
  task: '修改 src/calc.ts，添加 cube 函数',
  history: '',
});

const trimmed = resp.content.trim();
console.log('Content length:', resp.content.length);
console.log('Starts with {: ' + trimmed.startsWith('{'));
console.log('Ends with }: ' + trimmed.endsWith('}'));
console.log('Has fenced JSON: ' + /```json/.test(resp.content));

// Count JSON objects in output
const braceObjects = resp.content.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
console.log('JSON-like objects found:', braceObjects ? braceObjects.length : 0);

console.log('\n=== Q3: parseAIOutput result ===');
try {
  const parsed = parseAIOutput(resp.content);
  console.log('SUCCESS');
  console.log('summary:', parsed.summary);
  for (const c of parsed.changes) {
    console.log(' -', c.file, '(' + c.operation + '):', c.content.length, 'chars');
  }
} catch (err) {
  console.log('FAILED:', err.message);
}

console.log('\n--- RAW (first 1500 chars) ---');
console.log(resp.content.substring(0, 1500));
if (resp.content.length > 1500) {
  console.log('\n--- RAW (last 200 chars) ---');
  console.log(resp.content.substring(Math.max(0, resp.content.length - 200)));
}
