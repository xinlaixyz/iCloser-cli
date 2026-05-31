import { describe, expect, it } from 'vitest';
import {
  createProvider,
  buildOpenAICompatibleUserContent,
  formatProviderKeyGuidance,
  getAvailableProviders,
  getProviderKeyGuidance,
  getProviderInfo,
  getProviderStatus,
  inferProviderFromApiKey,
  isAIProvider,
  isLikelyApiKey,
  maskApiKey,
  normalizeProviderForApiKey,
  resolveProviderRequestModel,
  sanitizeDeepSeekMessageContent,
  smokeTestProvider,
} from '../src/ai/provider.js';

describe('mock provider', () => {
  it('generates deterministic write blocks from relevant context', async () => {
    const provider = createProvider({
      provider: 'mock',
      model: 'mock-offline',
      apiKey: '',
      maxTokens: 1000,
      temperature: 0,
    });

    const response = await provider.chat({
      systemPrompt: 'test',
      task: '修改 src/hello.ts 添加离线验收标记',
      history: '',
      context: {
        projectMeta: '',
        relevantMemory: '',
        totalTokens: 0,
        budgetUsed: 0,
        relevantCode: [{
          file: 'src/hello.ts',
          content: 'export const hello = "world";\n',
          relevance: 1,
          compression: 'full',
        }],
      },
    });

    expect(response.model).toBe('mock-offline');
    expect(response.content).toContain('```json');
    expect(response.content).toContain('"changes"');
    expect(response.structuredOutput?.changes[0]?.file).toBe('src/hello.ts');
    expect(response.content).toContain('icloser mock edit');
  });

  it('is listed as an available provider', () => {
    expect(getAvailableProviders().some(p => p.name === 'mock')).toBe(true);
  });

  it('exposes provider metadata and validates provider names', () => {
    const openai = getProviderInfo('openai');
    expect(openai.envVars).toContain('OPENAI_API_KEY');
    expect(openai.availableModels).toContain('gpt-4o');
    expect(isAIProvider('mock')).toBe(true);
    expect(isAIProvider('unknown')).toBe(false);
  });

  it('reports mock as ready and real providers as missing without keys', () => {
    const mock = getProviderStatus({
      provider: 'mock',
      model: 'mock-offline',
      apiKey: '',
      maxTokens: 1000,
      temperature: 0,
    });
    expect(mock.ready).toBe(true);
    expect(mock.keySource).toBe('not-required');

    const openai = getProviderStatus({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: '',
      maxTokens: 1000,
      temperature: 0,
    });
    expect(openai.ready).toBe(false);
    expect(openai.keySource).toBe('missing');
  });

  it('smoke tests mock provider without an API key', async () => {
    const result = await smokeTestProvider({
      provider: 'mock',
      model: 'mock-offline',
      apiKey: '',
      maxTokens: 1000,
      temperature: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('mock');
    expect(result.keySource).toBe('not-required');
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  it('answers directory analysis requests as read-only prose in mock mode', async () => {
    const provider = createProvider({
      provider: 'mock',
      model: 'mock-offline',
      apiKey: '',
      maxTokens: 1000,
      temperature: 0,
    });

    const response = await provider.chat({
      systemPrompt: 'test',
      task: '分析代码质量 整个目录',
      history: '',
      context: {
        projectMeta: 'TypeScript project',
        relevantMemory: '',
        totalTokens: 0,
        budgetUsed: 0,
        relevantCode: [{
          file: 'src/index.ts',
          content: 'export const ok = true;\n',
          relevance: 1,
          compression: 'full',
        }],
      },
    });

    expect(response.content).toContain('只读分析');
    expect(response.content).toContain('src/index.ts');
    expect(response.structuredOutput).toBeUndefined();
  });

  it('fails smoke test fast when a real provider has no API key', async () => {
    const result = await smokeTestProvider({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: '',
      maxTokens: 1000,
      temperature: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.keySource).toBe('missing');
    expect(result.error).toContain('OPENAI_API_KEY');
    expect(result.error).toContain('PowerShell');
    expect(result.error).toContain('ic setup --mock');
  });

  it('formats copyable key guidance for real providers', () => {
    const guide = getProviderKeyGuidance('deepseek');
    expect(guide.envVars).toEqual(['DEEPSEEK_API_KEY']);
    expect(guide.powershell).toBe('$env:DEEPSEEK_API_KEY="sk-..."');
    expect(guide.bash).toBe('export DEEPSEEK_API_KEY="sk-..."');

    const lines = formatProviderKeyGuidance('deepseek').join('\n');
    expect(lines).toContain('PowerShell');
    expect(lines).toContain('Bash/Zsh');
    expect(lines).toContain('验证');
    expect(lines).toContain('无 Key 先用: ic setup --mock');
  });

  it('reports mock key guidance as no-key-needed', () => {
    expect(formatProviderKeyGuidance('mock').join('\n')).toContain('不需要 API Key');
  });

  it('recognizes and masks pasted API keys for onboarding', () => {
    expect(isLikelyApiKey('sk-ant-1234567890abcdefghijklmnop')).toBe(true);
    expect(isLikelyApiKey('hello world')).toBe(false);
    expect(inferProviderFromApiKey('sk-ant-1234567890abcdefghijklmnop')).toBe('claude');
    expect(inferProviderFromApiKey('sk-1234567890abcdefghijklmnop', 'deepseek')).toBe('deepseek');
    expect(inferProviderFromApiKey('sk-1234567890abcdefghijklmnop', 'claude')).toBe('deepseek');
    expect(inferProviderFromApiKey('sk-1234567890abcdefghijklmnop', 'qwen')).toBe('deepseek');
    expect(inferProviderFromApiKey('sk-1234567890abcdefghijklmnop', 'openai')).toBe('deepseek');
    expect(maskApiKey('sk-1234567890abcdefghijklmnop')).toBe('sk-123...mnop');
  });

  it('maps DeepSeek product aliases to public API request models', () => {
    expect(resolveProviderRequestModel('deepseek', 'deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(resolveProviderRequestModel('deepseek', 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
    expect(resolveProviderRequestModel('deepseek', '')).toBe('deepseek-v4-pro');
    expect(resolveProviderRequestModel('openai', 'gpt-4o')).toBe('gpt-4o');
  });

  it('repairs provider/key mismatches from pasted generic keys', () => {
    expect(normalizeProviderForApiKey('claude', 'sk-1234567890abcdefghijklmnop')).toBe('deepseek');
    expect(normalizeProviderForApiKey('qwen', 'sk-1234567890abcdefghijklmnop')).toBe('deepseek');
    expect(normalizeProviderForApiKey('mock', 'sk-1234567890abcdefghijklmnop')).toBe('deepseek');
    expect(normalizeProviderForApiKey('openai', 'sk-1234567890abcdefghijklmnop')).toBe('deepseek');
    expect(normalizeProviderForApiKey('claude', 'sk-ant-1234567890abcdefghijklmnop')).toBe('claude');
  });

  it('passes tool and conversation history into OpenAI-compatible providers', () => {
    const content = buildOpenAICompatibleUserContent({
      systemPrompt: 'test',
      task: '告诉我这个网页是什么',
      history: '[工具(web_fetch)] 标题: icloser | 加密钱包、自托管与Web3支付入口',
      context: {
        projectMeta: '',
        relevantMemory: '',
        totalTokens: 0,
        budgetUsed: 0,
        relevantCode: [],
      },
    });
    expect(content).toContain('## 对话与工具历史');
    expect(content).toContain('icloser | 加密钱包、自托管与Web3支付入口');
  });

  it('escapes DeepSeek message text that contains Windows paths and regex backslashes', () => {
    const raw = 'D:\\temp\\Codex\\icloserxyz\\financial-risk-disclosure\nsearch_code /1\\.0[^0-9]/\ncss: content: "\\x";';
    const sanitized = sanitizeDeepSeekMessageContent(raw);
    expect(sanitized).toContain('D:/temp/Codex');
    expect(sanitized).toContain('/1/.0[^0-9]/');
    expect(sanitized).toContain('/x');
    expect(sanitized).not.toContain('\\');
  });
});

// ============================================================
// AI error classification
// ============================================================
import { classifyError, AICallError } from '../src/ai/errors.js';

describe('AICallError classification', () => {
  it('AICallError.toDisplay includes suggestion', () => {
    const err = new AICallError(
      'AUTH_FAILED',
      'deepseek',
      '鉴权失败',
      '请检查 API Key',
      'raw 401',
    );
    const display = err.toDisplay();
    expect(display).toContain('鉴权失败');
    expect(display).toContain('请检查 API Key');
    expect(display).toContain('raw 401');
  });

  it('AICallError has correct properties', () => {
    const err = new AICallError('NETWORK_ERROR', 'claude', '网络失败', '检查代理', 'ECONNREFUSED');
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.provider).toBe('claude');
    expect(err.name).toBe('AICallError');
    expect(err instanceof Error).toBe(true);
  });

  it('classifyError detects MISSING_API_KEY when env var not set', () => {
    delete process.env.DEEPSEEK_API_KEY;
    const err = classifyError(
      new Error('some error'),
      'deepseek',
      ['DEEPSEEK_API_KEY'],
    );
    expect(err.code).toBe('MISSING_API_KEY');
    expect(err.suggestion).toContain('DEEPSEEK_API_KEY');
  });

  it('classifyError detects AUTH_FAILED from 401 message', () => {
    process.env.OPENAI_API_KEY = 'sk-test-dummy';
    const err = classifyError(
      new Error('401 Unauthorized - invalid api key'),
      'openai',
      ['OPENAI_API_KEY'],
    );
    expect(err.code).toBe('AUTH_FAILED');
    delete process.env.OPENAI_API_KEY;
  });

  it('classifyError detects AUTH_FAILED from 403 message', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const err = classifyError(
      new Error('403 Forbidden: not authorized to access model'),
      'claude',
      ['ANTHROPIC_API_KEY'],
    );
    expect(err.code).toBe('AUTH_FAILED');
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('classifyError detects NETWORK_ERROR from ECONNREFUSED', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-dummy';
    const err = classifyError(
      new Error('connect ECONNREFUSED ::1:443'),
      'deepseek',
      ['DEEPSEEK_API_KEY'],
    );
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.suggestion).toContain('网络');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('classifyError detects NETWORK_ERROR from fetch failed', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-dummy';
    const err = classifyError(
      new Error('fetch failed'),
      'deepseek',
      ['DEEPSEEK_API_KEY'],
    );
    expect(err.code).toBe('NETWORK_ERROR');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('classifyError detects TIMEOUT', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-dummy';
    const err = classifyError(
      new Error('Request timed out after 30000ms'),
      'deepseek',
      ['DEEPSEEK_API_KEY'],
    );
    expect(err.code).toBe('TIMEOUT');
    expect(err.suggestion).toContain('网络延迟');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('classifyError detects ETIMEDOUT as TIMEOUT', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-dummy';
    const err = classifyError(
      new Error('connect ETIMEDOUT api.deepseek.com:443'),
      'deepseek',
      ['DEEPSEEK_API_KEY'],
    );
    expect(err.code).toBe('TIMEOUT');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('classifyError does not report missing env var when config apiKey exists', () => {
    delete process.env.OPENAI_API_KEY;
    const err = classifyError(
      new Error('401 Unauthorized - invalid api key'),
      'openai',
      ['OPENAI_API_KEY'],
      true,
    );
    expect(err.code).toBe('AUTH_FAILED');
  });

  it('classifyError detects INVALID_MODEL', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-dummy';
    const err = classifyError(
      new Error('model deepseek-v99 not found'),
      'deepseek',
      ['DEEPSEEK_API_KEY'],
    );
    expect(err.code).toBe('INVALID_MODEL');
    expect(err.suggestion).toContain('provider models');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('classifyError detects RATE_LIMITED', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-dummy';
    const err = classifyError(
      new Error('429 Too Many Requests - rate limit exceeded'),
      'deepseek',
      ['DEEPSEEK_API_KEY'],
    );
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.suggestion).toContain('重试');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('classifyError returns UNKNOWN for unrecognized errors', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-dummy';
    const err = classifyError(
      new Error('something unexpected happened'),
      'deepseek',
      ['DEEPSEEK_API_KEY'],
    );
    expect(err.code).toBe('UNKNOWN');
    delete process.env.DEEPSEEK_API_KEY;
  });
});
