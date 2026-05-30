import type { AIConfig, AIPrompt, AIProvider, AIResponse, ToolCall } from '../types.js';
import {
  createProvider,
  type AIProviderAdapter,
  type StreamCallback,
  type ToolDefinition,
} from './provider.js';
import { classifyError } from './errors.js';
import { normalizeEvidenceText } from '../core/evidence-store.js';

export interface ProviderGatewayOptions {
  maxHistoryChars?: number;
  maxTaskChars?: number;
  timeoutMs?: number;
}

export class ProviderGateway implements AIProviderAdapter {
  readonly name: string;
  readonly supportsStreaming: boolean;
  readonly supportsToolUse: boolean;
  readonly defaultModel: string;
  readonly availableModels: string[];

  constructor(
    private readonly config: AIConfig,
    private readonly inner: AIProviderAdapter = createProvider(config),
    private readonly options: ProviderGatewayOptions = {}
  ) {
    this.name = inner.name;
    this.supportsStreaming = inner.supportsStreaming;
    this.supportsToolUse = inner.supportsToolUse;
    this.defaultModel = inner.defaultModel;
    this.availableModels = inner.availableModels;
  }

  async chat(prompt: AIPrompt, tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      return await withTimeout(
        this.inner.chat(this.normalizePrompt(prompt), tools),
        this.options.timeoutMs ?? 60000,
        `${this.name} Provider 调用超时`
      );
    } catch (err) {
      throw classifyError(err, this.config.provider as AIProvider, providerEnvVars(this.config.provider), Boolean(this.config.apiKey));
    }
  }

  async chatStream(prompt: AIPrompt, onChunk: StreamCallback, tools?: ToolDefinition[]): Promise<AIResponse> {
    try {
      return await withTimeout(
        this.inner.chatStream(this.normalizePrompt(prompt), onChunk, tools),
        this.options.timeoutMs ?? 60000,
        `${this.name} Provider 流式调用超时`
      );
    } catch (err) {
      throw classifyError(err, this.config.provider as AIProvider, providerEnvVars(this.config.provider), Boolean(this.config.apiKey));
    }
  }

  private normalizePrompt(prompt: AIPrompt): AIPrompt {
    const maxHistory = this.options.maxHistoryChars ?? 12000;
    const maxTask = this.options.maxTaskChars ?? 12000;
    return {
      ...prompt,
      systemPrompt: normalizeEvidenceText(prompt.systemPrompt, 8000),
      task: normalizeEvidenceText(prompt.task, maxTask),
      history: normalizeEvidenceText(prompt.history || '', maxHistory),
      context: {
        ...prompt.context,
        projectMeta: normalizeEvidenceText(prompt.context.projectMeta || '', 6000),
        relevantMemory: normalizeEvidenceText(prompt.context.relevantMemory || '', 4000),
        externalKnowledge: prompt.context.externalKnowledge ? normalizeEvidenceText(prompt.context.externalKnowledge, 6000) : undefined,
        astHints: prompt.context.astHints ? normalizeEvidenceText(prompt.context.astHints, 4000) : undefined,
        relevantCode: prompt.context.relevantCode.slice(0, 20).map(item => ({
          ...item,
          file: item.file.replace(/\\/g, '/'),
          content: normalizeEvidenceText(item.content, 2500),
        })),
      },
    };
  }
}

export function createProviderGateway(config: AIConfig, options?: ProviderGatewayOptions): ProviderGateway {
  return new ProviderGateway(config, createProvider(config), options);
}

export function summarizeToolCallsForProvider(calls: Array<{ name: string; arguments: unknown } | ToolCall>): string {
  return calls.map(call => `${call.name}: ${JSON.stringify((call as ToolCall).arguments || {})}`).join('\n');
}

function providerEnvVars(provider: AIProvider): string[] {
  if (provider === 'deepseek') return ['DEEPSEEK_API_KEY'];
  if (provider === 'claude') return ['ANTHROPIC_API_KEY'];
  if (provider === 'openai') return ['OPENAI_API_KEY'];
  if (provider === 'qwen') return ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'];
  return [];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
