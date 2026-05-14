// Test relaxed prompt to see if model outputs prose around JSON
import { createProvider } from '../dist/ai/provider.js';
import { parseAIOutput } from '../dist/ai/output-contract.js';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
if (!API_KEY) { console.error('DEEPSEEK_API_KEY not set'); process.exit(1); }

const RELAXED_PROMPT = '你是代码助手。请回复修改方案。用 JSON 格式输出，包含 summary 和 changes 数组。每个 change 需要 file/operation/content/reasoning。';

const provider = createProvider({
  provider: 'deepseek', model: 'deepseek-v4-pro',
  apiKey: API_KEY, maxTokens: 100000, temperature: 0.3,
});

console.log('=== PROSE TEST: Relaxed prompt ===');
const resp = await provider.chat({
  systemPrompt: RELAXED_PROMPT,
  context: {
    projectMeta: '', totalTokens: 0, budgetUsed: 0,
    relevantCode: [{
      file: 'src/util.ts',
      content: 'export function greet(name: string): string { return "Hello, " + name; }\n',
      relevance: 1,
      compression: 'full',
    }],
    relevantMemory: '',
  },
  task: '修改 src/util.ts，添加一个 farewell 函数',
  history: '',
});

const trimmed = resp.content.trim();
console.log('Starts with {: ' + trimmed.startsWith('{'));
console.log('Ends with }: ' + trimmed.endsWith('}'));
console.log('Has fenced JSON: ' + /```/.test(resp.content));

try {
  const parsed = parseAIOutput(resp.content);
  console.log('parseAIOutput: SUCCESS');
  console.log('summary:', parsed.summary);
  console.log('changes:', parsed.changes.length);
  for (const c of parsed.changes) {
    console.log(' -', c.file, '(' + c.operation + '):', c.content.length, 'chars');
  }
} catch (err) {
  console.log('parseAIOutput: FAILED -', err.message);
}

console.log('\n--- RAW (first 1200 chars) ---');
console.log(resp.content.substring(0, 1200));
if (resp.content.length > 1200) {
  console.log('\n--- RAW (last 200 chars) ---');
  console.log(resp.content.substring(Math.max(0, resp.content.length - 200)));
}
