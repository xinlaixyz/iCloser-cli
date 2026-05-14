// AI Intent Classifier — hybrid regex + AI routing for user input
import type { UserIntent, UserIntentCategory } from '../types.js';

// ============================================================
// Phase 1: Fast regex/rule-based classifier (~70% coverage)
// ============================================================

interface RegexRule {
  patterns: RegExp[];
  category: UserIntentCategory;
  confidence: number;
  requiresConfirmation: boolean;
  reasoning: string;
}

// Rules ordered from MOST specific to LEAST specific.
// Specific intents (security, refactor, test, doc, config) MUST come before
// general intents (code_change, analysis) to avoid greedy matches.
const FAST_RULES: RegexRule[] = [
  // ── Specific intents first ──
  {
    patterns: [
      /(SQL注入|XSS|CSRF|权限越权|安全漏洞|安全风险|安全审查)/,
      /(security|vulnerability|exploit)/i,
      /(检查|扫描|审查).*(安全|漏洞|风险)/,
    ],
    category: 'security_review',
    confidence: 0.85,
    requiresConfirmation: false,
    reasoning: '用户要求安全检查或漏洞扫描',
  },
  {
    patterns: [
      /(重构|拆分|优化|整理|简化|清理).*(代码|函数|方法|类|模块|组件)/,
      /(这个|这段).*(太长|太乱|太复杂|不好维护|重复)/,
      /(refactor|optimize|clean|simplify).*(code|function|module)/i,
    ],
    category: 'refactor',
    confidence: 0.85,
    requiresConfirmation: true,
    reasoning: '用户要求重构或优化代码结构',
  },
  {
    patterns: [
      /(生成|补|补齐|补充|写|加).*(测试|单测|test|spec)/,
      /(测试|单测|test|spec).*(补|写|生成|加)/,
    ],
    category: 'test_gen',
    confidence: 0.9,
    requiresConfirmation: true,
    reasoning: '用户要求生成或补充测试',
  },
  {
    patterns: [
      /(生成|补|补齐|补充|写|创建).*(文档|doc|readme|api文档|注释)/,
      /(文档|doc).*(补|生成|写|创建|缺失)/,
    ],
    category: 'doc_gen',
    confidence: 0.9,
    requiresConfirmation: true,
    reasoning: '用户要求生成或补充文档',
  },
  {
    patterns: [
      /(配置|设置|切换|修改).*(key|密钥|provider|模型|语言)/,
      /(apikey|api.key|API Key|provider|config|设置)/,
      /(换|切换|改成).*(deepseek|claude|openai|qwen|mock)/i,
    ],
    category: 'config',
    confidence: 0.85,
    requiresConfirmation: false,
    reasoning: '用户在配置系统或 API Key',
  },
  {
    patterns: [
      /(你好|hi|hello|谢谢|感谢|再见|bye)/i,
      /^(ok|好的|嗯|哦|知道了|明白)[\s，。,.]*$/,
      /(你是谁|你能做什么|你有什么功能)/,
    ],
    category: 'chat',
    confidence: 0.95,
    requiresConfirmation: false,
    reasoning: '闲聊或问候，无工程意图',
  },
  // ── Broad intents second ──
  {
    patterns: [
      new RegExp('(修改|改|更新|添加|新增|创建|删除|移除|替换|rename|move).*(文件|代码|函数|方法|类|模块|组件|接口)'),
      new RegExp('(帮我|给我|请|麻烦).*(写|改|加|删|修|建|弄|实现|开发)'),
      /(add|create|write|delete|remove|update|change|fix|implement)/i,
      /(加个|加一个|写个|写一个|改下|改一下)/,
    ],
    category: 'code_change',
    confidence: 0.9,
    requiresConfirmation: true,
    reasoning: '用户要求修改或创建代码文件',
  },
  {
    patterns: [
      /^(分析|检查|审查|review|audit|scan)/i,
      /(这是什么|什么项目|是否完整|完整吗|完成度|质量如何|是什么项目|是什么语言|是什么框架|技术栈)/,
      /(代码质量|项目结构|架构分析|技术栈|功能清单)/,
      /(analyze|inspect|assess).*(project|code|repo)/i,
    ],
    category: 'analysis',
    confidence: 0.85,
    requiresConfirmation: false,
    reasoning: '用户要求分析或审查项目、代码质量、结构',
  },
  {
    patterns: [
      /^(怎么|如何|怎样|为什么|什么是|能不能|可以)/,
      /^(how|why|what|can|could|would|should|is it|does it)/i,
      /^(请教|请问|问一下|想问|想知道|了解)/,
      /(是什么意思|怎么用|干什么的|做什么的|有啥用)/,
    ],
    category: 'question',
    confidence: 0.8,
    requiresConfirmation: false,
    reasoning: '用户在提问或咨询',
  },
];

export function classifyIntentRegex(input: string): UserIntent | null {
  const normalized = input.trim();

  for (const rule of FAST_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        return {
          category: rule.category,
          confidence: rule.confidence,
          method: 'regex',
          reasoning: rule.reasoning,
          requiresConfirmation: rule.requiresConfirmation,
          extractedTask: extractTaskFromInput(normalized),
        };
      }
    }
  }

  return null;
}

// Extract the actual engineering task from conversational input
function extractTaskFromInput(input: string): string | undefined {
  // Loop-strip conversational prefixes until no more match
  let stripped = input.trim();
  const prefixes = /^(请|帮我|给我|能不能|可以|麻烦|帮忙|你好|哈喽|嗨)[，,]?\s*/;
  let changed = true;
  while (changed) {
    const before = stripped;
    stripped = stripped.replace(prefixes, '');
    changed = before !== stripped;
  }
  stripped = stripped.replace(/[？?！!。.]$/, '').trim();

  if (stripped.length >= 4 && stripped !== input.trim()) return stripped;
  if (input.trim().length >= 6) return input.trim();
  return undefined;
}

// ============================================================
// Phase 2: AI-based classifier (~30% coverage for ambiguous input)
// ============================================================

export async function classifyIntentAI(
  input: string,
  providerAdapter: { chat: (prompt: { systemPrompt: string; task: string; context: { projectMeta: string; relevantCode: never[]; relevantMemory: string; totalTokens: number; budgetUsed: number }; history: string }) => Promise<{ content: string; tokensUsed: number }> },
): Promise<UserIntent> {
  const systemPrompt = [
    '你是意图识别专家。分析用户输入，判断其工程意图类别。',
    '类别：analysis(分析项目) | code_change(修改代码) | security_review(安全检查) | refactor(重构优化) | test_gen(生成测试) | doc_gen(生成文档) | question(提问咨询) | config(配置系统) | chat(闲聊) | unknown(无法识别)',
    '',
    '输出 JSON：{"category":"类别","confidence":0.9,"reasoning":"判断理由","extractedTask":"提取的任务描述"}',
    '',
    '规则：',
    '- 有明确文件修改意图 → code_change',
    '- 询问项目情况/质量/结构 → analysis',
    '- 涉及安全漏洞 → security_review',
    '- 只是提问/咨询 → question',
    '- 配置/设置类 → config',
  ].join('\n');

  try {
    const response = await providerAdapter.chat({
      systemPrompt,
      task: input,
      context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
      history: '',
    });

    try {
      const jsonStart = response.content.indexOf('{');
      const jsonEnd = response.content.lastIndexOf('}') + 1;
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(response.content.slice(jsonStart, jsonEnd));
        return {
          category: parsed.category || 'unknown',
          confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
          method: 'ai',
          reasoning: parsed.reasoning || 'AI 判断',
          requiresConfirmation: ['code_change', 'refactor', 'test_gen', 'doc_gen'].includes(parsed.category),
          extractedTask: parsed.extractedTask,
        };
      }
    } catch { /* JSON parse failed, use raw content */ }
  } catch { /* AI call failed */ }

  // Fallback
  return {
    category: 'unknown',
    confidence: 0.1,
    method: 'ai',
    reasoning: 'AI 分类器未能返回有效结果',
    requiresConfirmation: false,
  };
}

// ============================================================
// Unified intent classifier
// ============================================================

export async function classifyIntent(
  input: string,
  options?: { useAI?: boolean; aiProvider?: Parameters<typeof classifyIntentAI>[1] },
): Promise<UserIntent> {
  // Phase 1: Try regex (fast, offline, covers ~70%)
  const regexResult = classifyIntentRegex(input);
  if (regexResult && regexResult.confidence >= 0.8) {
    return regexResult;
  }

  // Phase 2: For ambiguous/low-confidence regex results, try AI
  if (options?.useAI !== false && options?.aiProvider) {
    try {
      const aiResult = await classifyIntentAI(input, options.aiProvider);
      if (aiResult.confidence > (regexResult?.confidence || 0.3)) return aiResult;
    } catch { /* AI fallback failed */ }
  }

  // Phase 3: Use regex result if AI wasn't better
  if (regexResult) return regexResult;

  // Phase 4: Default to unknown
  return {
    category: 'unknown',
    confidence: 0.1,
    method: 'regex',
    reasoning: '无法从输入中识别明确工程意图',
    requiresConfirmation: false,
  };
}
