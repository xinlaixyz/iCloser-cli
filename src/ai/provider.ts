// AI Provider abstraction layer — multi-provider adapter
import type { AIProvider, AIConfig, AIPrompt, AIResponse, ToolCall } from '../types.js';
import { classifyError, AICallError } from './errors.js';
import { createAIOutputContract, formatAIOutputContract } from './output-contract.js';

// ============================================================
// Provider interface
// ============================================================
export type StreamCallback = (chunk: string) => void;

export interface AIProviderAdapter {
  name: string;
  chat(prompt: AIPrompt, tools?: ToolDefinition[]): Promise<AIResponse>;
  chatStream(prompt: AIPrompt, onChunk: StreamCallback, tools?: ToolDefinition[]): Promise<AIResponse>;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  defaultModel: string;
  availableModels: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderInfo {
  name: AIProvider;
  label: string;
  defaultModel: string;
  availableModels: string[];
  envVars: string[];
  requiresApiKey: boolean;
}

export interface ProviderStatus extends ProviderInfo {
  current: boolean;
  configuredModel: string;
  keySource: 'config' | 'env' | 'not-required' | 'missing';
  ready: boolean;
}

export interface ProviderSmokeResult {
  provider: AIProvider;
  model: string;
  ok: boolean;
  duration: number;
  keySource: ProviderStatus['keySource'];
  tokensUsed: number;
  error?: string;
}

export interface ProviderKeyGuidance {
  provider: AIProvider;
  requiresApiKey: boolean;
  envVars: string[];
  powershell?: string;
  bash?: string;
  cmd?: string;
  verify: string;
  offline: string;
}

// ============================================================
// Provider factory
// ============================================================
export function createProvider(config: AIConfig): AIProviderAdapter {
  switch (config.provider) {
    case 'mock':
      return new MockProvider(config);
    case 'claude':
      return new ClaudeProvider(config);
    case 'deepseek':
      return new DeepSeekProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'qwen':
      return new QwenProvider(config);
    default:
      return new ClaudeProvider(config);
  }
}

const PROVIDER_INFOS: ProviderInfo[] = [
  {
    name: 'mock',
    label: 'Mock (offline test)',
    defaultModel: 'mock-offline',
    availableModels: ['mock-offline'],
    envVars: [],
    requiresApiKey: false,
  },
  {
    name: 'claude',
    label: 'Claude (Anthropic)',
    defaultModel: 'claude-sonnet-4-6',
    availableModels: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101'],
    envVars: ['ANTHROPIC_API_KEY'],
    requiresApiKey: true,
  },
  {
    name: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-pro',
    availableModels: ['deepseek-v4-pro', 'deepseek-v3', 'deepseek-r1'],
    envVars: ['DEEPSEEK_API_KEY'],
    requiresApiKey: true,
  },
  {
    name: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    availableModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3'],
    envVars: ['OPENAI_API_KEY'],
    requiresApiKey: true,
  },
  {
    name: 'qwen',
    label: 'Qwen (通义千问)',
    defaultModel: 'qwen-max',
    availableModels: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    envVars: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    requiresApiKey: true,
  },
];

export function getAvailableProviders(): ProviderInfo[] {
  return PROVIDER_INFOS.map(provider => ({
    ...provider,
    availableModels: [...provider.availableModels],
    envVars: [...provider.envVars],
  }));
}

export function getProviderInfo(provider: AIProvider): ProviderInfo {
  const info = PROVIDER_INFOS.find(item => item.name === provider);
  if (!info) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return {
    ...info,
    availableModels: [...info.availableModels],
    envVars: [...info.envVars],
  };
}

export function isAIProvider(value: string): value is AIProvider {
  return PROVIDER_INFOS.some(provider => provider.name === value);
}

export function getProviderStatus(config: AIConfig, provider: AIProvider = config.provider): ProviderStatus {
  const info = getProviderInfo(provider);
  const hasConfigKey = Boolean(config.provider === provider && config.apiKey);
  const hasEnvKey = info.envVars.some(envVar => Boolean(process.env[envVar]));
  const keySource: ProviderStatus['keySource'] = !info.requiresApiKey
    ? 'not-required'
    : hasConfigKey
      ? 'config'
      : hasEnvKey
        ? 'env'
        : 'missing';

  return {
    ...info,
    current: config.provider === provider,
    configuredModel: config.provider === provider ? config.model : info.defaultModel,
    keySource,
    ready: keySource !== 'missing',
  };
}

export function getProviderStatuses(config: AIConfig): ProviderStatus[] {
  return PROVIDER_INFOS.map(provider => getProviderStatus(config, provider.name));
}

export function isLikelyApiKey(value: string): boolean {
  const key = value.trim();
  if (/\s/.test(key)) return false;
  return /^(sk-|sk-ant-|sk-or-|dashscope-|qwen-|ak-)[A-Za-z0-9._-]{12,}$/.test(key);
}

export function inferProviderFromApiKey(value: string, fallback: AIProvider = 'deepseek'): AIProvider {
  const key = value.trim();
  if (key.startsWith('sk-ant-')) return 'claude';
  if (key.startsWith('sk-or-')) return 'openai';
  if (key.startsWith('dashscope-') || key.startsWith('qwen-') || key.startsWith('ak-')) return 'qwen';
  return fallback === 'mock' ? 'deepseek' : fallback;
}

export function maskApiKey(value: string): string {
  const key = value.trim();
  if (key.length <= 12) return '*'.repeat(Math.max(4, key.length));
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export function getProviderKeyGuidance(provider: AIProvider): ProviderKeyGuidance {
  const info = getProviderInfo(provider);
  const primary = info.envVars[0];

  return {
    provider,
    requiresApiKey: info.requiresApiKey,
    envVars: info.envVars,
    powershell: primary ? `$env:${primary}="sk-..."` : undefined,
    bash: primary ? `export ${primary}="sk-..."` : undefined,
    cmd: primary ? `set ${primary}=sk-...` : undefined,
    verify: 'ic provider test',
    offline: 'ic setup --mock',
  };
}

export function formatProviderKeyGuidance(provider: AIProvider): string[] {
  const guide = getProviderKeyGuidance(provider);
  if (!guide.requiresApiKey) {
    return ['mock provider 不需要 API Key，可直接使用。'];
  }

  const lines = [
    `需要配置 ${guide.envVars.join(' 或 ')} 后才能调用真实模型。`,
  ];
  if (guide.powershell) lines.push(`PowerShell: ${guide.powershell}`);
  if (guide.bash) lines.push(`Bash/Zsh:    ${guide.bash}`);
  if (guide.cmd) lines.push(`CMD:         ${guide.cmd}`);
  lines.push(`验证:        ${guide.verify}`);
  lines.push(`无 Key 先用: ${guide.offline}`);
  return lines;
}

export async function smokeTestProvider(config: AIConfig): Promise<ProviderSmokeResult> {
  const status = getProviderStatus(config);
  const start = Date.now();

  if (!status.ready) {
    return {
      provider: config.provider,
      model: config.model,
      ok: false,
      duration: Date.now() - start,
      keySource: status.keySource,
      tokensUsed: 0,
      error: formatProviderKeyGuidance(config.provider).join('\n  '),
    };
  }

  try {
    const provider = createProvider(config);
    const response = await provider.chat({
      systemPrompt: 'You are a health check endpoint. Reply with exactly: OK',
      task: 'Reply with exactly: OK',
      history: '',
      context: {
        projectMeta: '',
        relevantCode: [],
        relevantMemory: '',
        totalTokens: 0,
        budgetUsed: 0,
      },
    });
    return {
      provider: config.provider,
      model: response.model || config.model,
      ok: response.content.trim().length > 0,
      duration: Date.now() - start,
      keySource: status.keySource,
      tokensUsed: response.tokensUsed || 0,
      error: response.content.trim().length > 0 ? undefined : 'Provider returned an empty response',
    };
  } catch (err) {
    const baseMsg = (err as Error).message;
    const suggestion = err instanceof AICallError ? err.suggestion : '';
    return {
      provider: config.provider,
      model: config.model,
      ok: false,
      duration: Date.now() - start,
      keySource: status.keySource,
      tokensUsed: 0,
      error: suggestion ? `${baseMsg}\n  建议：${suggestion}` : baseMsg,
    };
  }
}

// ============================================================
// Mock Provider (offline deterministic test adapter)
// ============================================================
class MockProvider implements AIProviderAdapter {
  name = 'mock';
  supportsStreaming = true;
  supportsToolUse = false;
  defaultModel = 'mock-offline';
  availableModels = ['mock-offline'];

  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async chat(prompt: AIPrompt): Promise<AIResponse> {
    // 0. Orchestration/decomposition prompts → return structured subtasks
    if (/(拆解|分解|拆分|子任务|并行执行|subtask)/i.test(prompt.task)) {
      const taskMatch = prompt.task.match(/任务[：:]\s*(.+)/);
      const target = taskMatch ? taskMatch[1] : prompt.task;
      const response = [
        `1. 扫描并分析 ${target.slice(0, 30)} 的代码结构和依赖`,
        `2. 识别代码质量问题（重复代码、过长函数、安全风险）`,
        `3. 修复高优先级问题并验证`,
        `4. 生成修复报告`,
      ].join('\n');
      return { content: response, tokensUsed: Math.ceil(response.length / 4), model: this.config.model || this.defaultModel };
    }

    // 1. Analysis-only tasks → text response, no file operations
    if (isAnalysisOnlyTask(prompt.task)) {
      const files = prompt.context.relevantCode.map(snippet => snippet.file).slice(0, 8);
      const response = [
        '已基于项目上下文进行只读分析。',
        '',
        files.length > 0 ? `参考文件：${files.join(', ')}` : '当前上下文未包含具体源码片段，建议先运行 /scan 刷新索引。',
        '',
        '初步建议：优先检查模块边界、重复逻辑、错误处理一致性、测试覆盖和敏感配置保护。',
      ].join('\n');
      return {
        content: response,
        tokensUsed: Math.ceil(response.length / 4),
        model: this.config.model || this.defaultModel,
      };
    }

    // 2. Engineering task with file targets → use tools (hands)
    const targets = findTargetSnippets(prompt);
    if (targets.length > 0) {
      const structuredOutput = createAIOutputContract('Mock Provider 已生成离线测试修改。', targets.map(target => ({
        file: target.file,
        operation: 'write',
        content: applyMockEdit(target.file, target.content, prompt.task),
        reasoning: `mock provider deterministic edit for: ${prompt.task.substring(0, 120)}`,
      })));
      const response = formatAIOutputContract(structuredOutput);
      return {
        content: response,
        structuredOutput,
        tokensUsed: Math.ceil(response.length / 4),
        model: this.config.model || this.defaultModel,
      };
    }

    // 3. No file targets — AI brain handles as conversation
    // Generate contextual response based on what the user actually said
    const files = prompt.context.relevantCode.map(snippet => snippet.file).slice(0, 8);
    const response = chatResponse(prompt.task, files);

    return {
      content: response,
      tokensUsed: Math.ceil(response.length / 4),
      model: this.config.model || this.defaultModel,
    };
  }

  async chatStream(prompt: AIPrompt, onChunk: StreamCallback): Promise<AIResponse> {
    const response = await this.chat(prompt);
    for (const chunk of response.content.match(/.{1,24}/gs) || []) {
      onChunk(chunk);
    }
    return response;
  }
}

function chatResponse(task: string, files: string[]): string {
  const t = task.trim();
  const hasFiles = files.length > 0;
  const fileHint = hasFiles ? `\n当前项目中有：${files.slice(0, 6).join('、')}${files.length > 6 ? '等' : ''}` : '';

  // Capability questions: "你能做啥", "你会什么", "你有什么功能"
  if (/能[做干]|会[做干]|功能|能力/.test(t)) {
    return [
      '我可以帮你处理这些工程任务：',
      '',
      '• 📂 读写文件、搜索代码、执行命令',
      '• 🧠 解析 TS/JS/Go/Python/Java/Kotlin/Swift/ObjC/SQL 代码',
      '• 📖 自动生成项目文档（README、架构、API）',
      '• 🧪 分析测试缺口并补测试',
      '• ✅ 每次修改后自动验证（build + lint + test）',
      '',
      '试试说 "分析这个项目" 或 "帮我补文档"。' + fileHint,
    ].join('\n');
  }

  // How-to questions: "怎么用", "如何操作", "我应该怎么做"
  if (/怎么|如何|怎样|怎么做|怎么用|怎么操作/.test(t)) {
    return [
      '使用很简单，直接用自然语言告诉我想做什么就行：',
      '',
      '• "分析这个项目" — 全面扫描代码结构和质量',
      '• "帮我写 README" — 自动生成文档',
      '• "给 user 模块补测试" — 自动生成测试用例',
      '• "启动项目" — 运行开发服务器',
      '',
      '也可以输入 / 开头使用快捷命令：/help 查看全部，/doctor 检查状态。' + fileHint,
    ].join('\n');
  }

  // Identity questions: "你是谁", "你叫什么"
  if (/你是谁|你叫什么|你是什么|自我介绍/.test(t)) {
    return [
      '我是 iCloser Agent Shell，一个运行在本地的 AI 工程助手。',
      '我能理解自然语言，自动完成代码分析、修改、测试、文档等工程任务。',
      '',
      '当前工作在 ' + (hasFiles ? '一个有 ' + files.length + ' 个文件的项目中' : '一个空项目中，试试说 /scan 刷新索引') + '。' + fileHint,
    ].join('\n');
  }

  // "你告诉我" / "你说" / "讲一下" — user wants info, not action
  if (/告诉|说说|讲[一给]|给我说|跟我说/.test(t)) {
    return [
      '好的！你想了解什么？',
      '',
      '我可以告诉你：',
      '• 项目结构 — 说 "分析项目"',
      '• 测试覆盖 — 说 "检查测试缺口"',
      '• 依赖情况 — 说 "扫描依赖"',
      '• 代码质量 — 说 "检查代码质量"',
      '',
      '或者直接告诉我你想做什么。' + fileHint,
    ].join('\n');
  }

  // Greetings
  if (/^(你好|嗨|哈喽|hello|hi|hey|在吗|有人吗)[\s！!。.]*$/i.test(t)) {
    return '你好！我是 iCloser Agent Shell。直接告诉我你想做什么就行。' + fileHint;
  }

  // Thanks
  if (/^(谢谢|感谢|thanks|thank)/i.test(t)) {
    return '不客气！有需要随时说。';
  }

  // Short unclear input
  if (t.length < 8) {
    return '可以说得更具体一点吗？比如 "分析项目"、"帮我写文档"、"这个项目怎么跑起来"。' + fileHint;
  }

  // Default: contextual response that references the user's input
  return [
    '好的，我理解了。',
    '',
    '你说的是："' + (t.length > 80 ? t.substring(0, 80) + '…' : t) + '"',
    '',
    '如果这是一个工程任务，可以试试：',
    '• 说得更具体一些（比如要改哪个文件、做什么改动）',
    '• 告诉我文件路径，我可以直接操作',
    '',
    '如果是问问题，也可以直接问。' + fileHint,
  ].join('\n');
}

function isAnalysisOnlyTask(task: string): boolean {
  return /(分析|检查|review|扫描|质量|代码质量|当前目录|整个目录|整个项目)/i.test(task) &&
    !/(修改|创建|写入|生成文件|新增|删除|修复|改成|更新|update|write|create|delete|fix)/i.test(task);
}

function findTargetSnippets(prompt: AIPrompt): { file: string; content: string }[] {
  const explicitFiles = extractExplicitFiles(prompt.task);
  if (explicitFiles.length > 0) {
    return explicitFiles.map(file => {
      const normalizedExplicit = normalizePath(file);
      const matched = prompt.context.relevantCode.find(snippet =>
        normalizePath(snippet.file) === normalizedExplicit ||
        normalizePath(snippet.file).endsWith('/' + normalizedExplicit)
      );
      if (matched) return { file: matched.file, content: matched.content };
      return { file: file.replace(/\\/g, '/'), content: defaultMockContent(file) };
    });
  }

  const target = findTargetSnippet(prompt);
  return target ? [target] : [];
}

function extractExplicitFiles(task: string): string[] {
  const matches = task.matchAll(/([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|go|py|rs|java|kt|cs|php|rb|swift|c|cpp|h|hpp|md|txt|json|yaml|yml))/gi);
  const files = new Set<string>();
  for (const match of matches) {
    files.add(match[1]);
  }
  return [...files];
}

function findTargetSnippet(prompt: AIPrompt): { file: string; content: string } | null {
  const explicit = prompt.task.match(/([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|go|py|rs|java|kt|cs|php|rb|swift|c|cpp|h|hpp|md|txt|json|yaml|yml))/i)?.[1];
  if (explicit) {
    const normalizedExplicit = normalizePath(explicit);
    const matched = prompt.context.relevantCode.find(snippet =>
      normalizePath(snippet.file) === normalizedExplicit ||
      normalizePath(snippet.file).endsWith('/' + normalizedExplicit)
    );
    if (matched) return { file: matched.file, content: matched.content };
    return { file: explicit.replace(/\\/g, '/'), content: defaultMockContent(explicit) };
  }

  const fullSnippet = prompt.context.relevantCode.find(snippet => snippet.compression === 'full');
  const firstSnippet = fullSnippet || prompt.context.relevantCode[0];
  if (!firstSnippet) return null;
  return { file: firstSnippet.file, content: firstSnippet.content };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function defaultMockContent(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  if (ext === 'json') return '{\n  "mock": true\n}\n';
  if (ext === 'md') return '# Mock Output\n\nGenerated by iCloser mock provider.\n';
  return `${mockComment(file, 'iCloser mock provider created this file.')}\n`;
}

function applyMockEdit(file: string, original: string, task: string): string {
  const trimmed = original.trimEnd();
  const marker = 'iCloser mock edit';
  if (trimmed.includes(marker)) return trimmed + '\n';
  return `${trimmed}\n${mockComment(file, `${marker}: ${task.substring(0, 120)}`)}\n`;
}

function mockComment(file: string, message: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  if (ext === 'md') return `<!-- ${message} -->`;
  if (ext === 'py' || ext === 'rb' || ext === 'yml' || ext === 'yaml' || ext === 'txt') return `# ${message}`;
  return `// ${message}`;
}

// ============================================================
// Claude Provider (Anthropic SDK)
// ============================================================
class ClaudeProvider implements AIProviderAdapter {
  name = 'claude';
  supportsStreaming = true;
  supportsToolUse = true;
  defaultModel = 'claude-sonnet-4-6';
  availableModels = [
    'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
    'claude-opus-4-5-20251101',
  ];

  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async chat(prompt: AIPrompt, tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      // Dynamic import to avoid requiring the SDK when not using Claude
      const { default: Anthropic } = await import('@anthropic-ai/sdk');

      const client = new Anthropic({
        apiKey: this.config.apiKey || process.env.ANTHROPIC_API_KEY || '',
        baseURL: this.config.baseUrl,
      });

      const messages: { role: 'user' | 'assistant'; content: string }[] = [
        {
          role: 'user',
          content: `${prompt.context.projectMeta}\n\n${prompt.context.relevantCode.map(c => `// ${c.file}\n${c.content}`).join('\n\n')}\n\n${prompt.context.relevantMemory}${prompt.context.externalKnowledge ? '\n\n## 网络搜索结果\n' + prompt.context.externalKnowledge : ''}${prompt.context.astHints ? '\n\n## 代码调用关系\n' + prompt.context.astHints : ''}\n\n任务：${prompt.task}\n\n历史：${prompt.history}`,
        },
      ];

      const response = await client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: prompt.systemPrompt,
        messages,
        tools: tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: 'object' as const,
            properties: t.parameters?.properties || {},
            ...(t.parameters?.required ? { required: t.parameters.required as string[] } : {}),
          },
        })),
      });

      const content = response.content
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map(block => ('text' in block ? (block as { text: string }).text : ''))
        .join('\n');

      const toolCalls: ToolCall[] = response.content
        .filter((block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use')
        .map(block => {
          const toolBlock = block as { name: string; input: Record<string, unknown> };
          return {
            name: toolBlock.name,
            arguments: toolBlock.input,
          };
        });

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        model: response.model,
      };
    } catch (err) {
      throw classifyError(err, 'claude', ['ANTHROPIC_API_KEY'], Boolean(this.config.apiKey));
    }
  }

  async chatStream(prompt: AIPrompt, onChunk: StreamCallback, _tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');

      const client = new Anthropic({
        apiKey: this.config.apiKey || process.env.ANTHROPIC_API_KEY || '',
        baseURL: this.config.baseUrl,
      });

      const messages: { role: 'user' | 'assistant'; content: string }[] = [
        {
          role: 'user',
          content: `${prompt.context.projectMeta}\n\n${prompt.context.relevantCode.map(c => `// ${c.file}\n${c.content}`).join('\n\n')}\n\n${prompt.context.relevantMemory}${prompt.context.externalKnowledge ? '\n\n## 网络搜索结果\n' + prompt.context.externalKnowledge : ''}${prompt.context.astHints ? '\n\n## 代码调用关系\n' + prompt.context.astHints : ''}\n\n任务：${prompt.task}\n\n历史：${prompt.history}`,
        },
      ];

      const stream = client.messages.stream({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: prompt.systemPrompt,
        messages,
        tools: _tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: 'object' as const,
            properties: t.parameters?.properties || {},
            ...(t.parameters?.required ? { required: t.parameters.required as string[] } : {}),
          },
        })),
      });

      let fullContent = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          onChunk(event.delta.text);
          fullContent += event.delta.text;
        }
      }

      const finalMessage = await stream.finalMessage();
      const tokensUsed = finalMessage.usage.input_tokens + finalMessage.usage.output_tokens;

      const toolCalls: ToolCall[] = finalMessage.content
        .filter((block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use')
        .map(block => {
          const toolBlock = block as { name: string; input: Record<string, unknown> };
          return { name: toolBlock.name, arguments: toolBlock.input };
        });

      return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokensUsed,
        model: finalMessage.model,
      };
    } catch (err) {
      throw classifyError(err, 'claude', ['ANTHROPIC_API_KEY'], Boolean(this.config.apiKey));
    }
  }
}

// ============================================================
// DeepSeek Provider
// ============================================================
class DeepSeekProvider implements AIProviderAdapter {
  name = 'deepseek';
  supportsStreaming = true;
  supportsToolUse = true;
  defaultModel = 'deepseek-v4-pro';
  availableModels = ['deepseek-v4-pro', 'deepseek-v3', 'deepseek-r1'];

  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async chat(prompt: AIPrompt, tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      const { default: OpenAI } = await import('openai');

      const client = new OpenAI({
        apiKey: this.config.apiKey || process.env.DEEPSEEK_API_KEY || '',
        baseURL: this.config.baseUrl || 'https://api.deepseek.com/v1',
      });

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: prompt.systemPrompt },
        {
          role: 'user',
          content: prompt.task + '\n\n上下文：\n' +
            prompt.context.relevantCode.map(c => `// ${c.file}\n${c.content}`).join('\n\n') +
            (prompt.context.relevantMemory ? '\n\n## 项目记忆\n' + prompt.context.relevantMemory : '') +
            (prompt.context.externalKnowledge ? '\n\n## 网络搜索结果\n' + prompt.context.externalKnowledge : '') +
            (prompt.context.astHints ? '\n\n## 代码调用关系\n' + prompt.context.astHints : ''),
        },
      ];

      const response = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages,
        tools: tools?.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      });

      const choice = response.choices[0];
      const content = choice.message.content || '';

      const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map(tc => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokensUsed: response.usage?.total_tokens || 0,
        model: response.model,
      };
    } catch (err) {
      throw classifyError(err, 'deepseek', ['DEEPSEEK_API_KEY'], Boolean(this.config.apiKey));
    }
  }

  async chatStream(prompt: AIPrompt, onChunk: StreamCallback, _tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      const { default: OpenAI } = await import('openai');

      const client = new OpenAI({
        apiKey: this.config.apiKey || process.env.DEEPSEEK_API_KEY || '',
        baseURL: this.config.baseUrl || 'https://api.deepseek.com/v1',
      });

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.task + '\n\n上下文：\n' +
          prompt.context.relevantCode.map(c => `// ${c.file}\n${c.content}`).join('\n\n') +
          (prompt.context.relevantMemory ? '\n\n## 项目记忆\n' + prompt.context.relevantMemory : '') +
          (prompt.context.externalKnowledge ? '\n\n## 网络搜索结果\n' + prompt.context.externalKnowledge : '') +
          (prompt.context.astHints ? '\n\n## 代码调用关系\n' + prompt.context.astHints : '') },
      ];

      const stream = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages,
        stream: true,
        ...(_tools && _tools.length > 0 ? {
          tools: _tools.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        } : {}),
      });

      let fullContent = '';
      let totalTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          onChunk(delta);
        }
        if (chunk.usage?.total_tokens) {
          totalTokens = chunk.usage.total_tokens;
        }
      }

      return {
        content: fullContent,
        tokensUsed: totalTokens,
        model: this.config.model,
      };
    } catch (err) {
      throw classifyError(err, 'deepseek', ['DEEPSEEK_API_KEY'], Boolean(this.config.apiKey));
    }
  }
}

// ============================================================
// OpenAI Provider
// ============================================================
class OpenAIProvider implements AIProviderAdapter {
  name = 'openai';
  supportsStreaming = true;
  supportsToolUse = true;
  defaultModel = 'gpt-4o';
  availableModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3'];

  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async chat(prompt: AIPrompt, tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      const { default: OpenAI } = await import('openai');

      const client = new OpenAI({
        apiKey: this.config.apiKey || process.env.OPENAI_API_KEY || '',
        baseURL: this.config.baseUrl,
      });

      const response = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          { role: 'system', content: prompt.systemPrompt },
          {
            role: 'user',
            content: prompt.task + '\n\n上下文：\n' +
              prompt.context.relevantCode.map(c => `// ${c.file}\n${c.content}`).join('\n\n') +
              (prompt.context.relevantMemory ? '\n\n## 项目记忆\n' + prompt.context.relevantMemory : '') +
              (prompt.context.externalKnowledge ? '\n\n## 网络搜索结果\n' + prompt.context.externalKnowledge : '') +
              (prompt.context.astHints ? '\n\n## 代码调用关系\n' + prompt.context.astHints : ''),
          },
        ],
        tools: tools?.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      });

      const choice = response.choices[0];
      const content = choice.message.content || '';

      return {
        content,
        tokensUsed: response.usage?.total_tokens || 0,
        model: response.model,
      };
    } catch (err) {
      throw classifyError(err, 'openai', ['OPENAI_API_KEY'], Boolean(this.config.apiKey));
    }
  }

  async chatStream(prompt: AIPrompt, onChunk: StreamCallback, _tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: this.config.apiKey || process.env.OPENAI_API_KEY || '',
        baseURL: this.config.baseUrl,
      });

      const stream = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          { role: 'system', content: prompt.systemPrompt },
          {
            role: 'user',
            content: prompt.task + '\n\n上下文：\n' + prompt.context.projectMeta +
              (prompt.context.relevantMemory ? '\n\n## 项目记忆\n' + prompt.context.relevantMemory : '') +
              (prompt.context.externalKnowledge ? '\n\n## 网络搜索结果\n' + prompt.context.externalKnowledge : '') +
              (prompt.context.astHints ? '\n\n## 代码调用关系\n' + prompt.context.astHints : ''),
          },
        ],
        stream: true,
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) { fullContent += delta; onChunk(delta); }
      }
      return { content: fullContent, tokensUsed: 0, model: this.config.model };
    } catch (streamErr) {
      try {
        return await this.chat(prompt, _tools);
      } catch {
        throw streamErr; // preserve original streaming error if both fail
      }
    }
  }
}

// ============================================================
// Qwen Provider
// ============================================================
class QwenProvider implements AIProviderAdapter {
  name = 'qwen';
  supportsStreaming = true;
  supportsToolUse = true;
  defaultModel = 'qwen-max';
  availableModels = ['qwen-max', 'qwen-plus', 'qwen-turbo'];

  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async chat(prompt: AIPrompt, tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      const { default: OpenAI } = await import('openai');

      const client = new OpenAI({
        apiKey: this.config.apiKey || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '',
        baseURL: this.config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });

      const response = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          { role: 'system', content: prompt.systemPrompt },
          {
            role: 'user',
            content: prompt.task + '\n\n上下文：\n' +
              prompt.context.relevantCode.map(c => `// ${c.file}\n${c.content}`).join('\n\n') +
              (prompt.context.relevantMemory ? '\n\n## 项目记忆\n' + prompt.context.relevantMemory : '') +
              (prompt.context.astHints ? '\n\n## 代码调用关系\n' + prompt.context.astHints : ''),
          },
        ],
        ...(tools?.length ? {
          tools: tools.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        } : {}),
      });

      const choice = response.choices[0];
      const content = choice.message.content || '';

      // Extract tool calls from Qwen response (OpenAI-compatible format)
      const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map((tc: any) => ({
        name: tc.function?.name || '',
        arguments: JSON.parse(tc.function?.arguments || '{}'),
      }));

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokensUsed: response.usage?.total_tokens || 0,
        model: response.model,
      };
    } catch (err) {
      throw classifyError(err, 'qwen', ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'], Boolean(this.config.apiKey));
    }
  }

  async chatStream(prompt: AIPrompt, onChunk: StreamCallback): Promise<AIResponse> {
    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: this.config.apiKey || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '',
        baseURL: this.config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });

      const stream = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          { role: 'system', content: prompt.systemPrompt },
          {
            role: 'user',
            content: prompt.task + '\n\n上下文：\n' + prompt.context.projectMeta +
              (prompt.context.relevantMemory ? '\n\n## 项目记忆\n' + prompt.context.relevantMemory : '') +
              (prompt.context.astHints ? '\n\n## 代码调用关系\n' + prompt.context.astHints : ''),
          },
        ],
        stream: true,
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) { fullContent += delta; onChunk(delta); }
      }
      return { content: fullContent, tokensUsed: 0, model: this.config.model };
    } catch (qwenStreamErr) {
      try { return await this.chat(prompt); } catch { throw qwenStreamErr; }
    }
  }
}
