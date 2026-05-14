// AI Provider error classification — structured errors with next-step guidance
import type { AIProvider } from '../types.js';

export type AICallErrorCode =
  | 'MISSING_API_KEY'
  | 'AUTH_FAILED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'EMPTY_RESPONSE'
  | 'INVALID_MODEL'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export class AICallError extends Error {
  readonly code: AICallErrorCode;
  readonly provider: AIProvider;
  readonly suggestion: string;
  readonly raw?: string;

  constructor(
    code: AICallErrorCode,
    provider: AIProvider,
    message: string,
    suggestion: string,
    raw?: string,
  ) {
    super(message);
    this.name = 'AICallError';
    this.code = code;
    this.provider = provider;
    this.suggestion = suggestion;
    this.raw = raw;
  }

  /** Multi-line display string suitable for CLI output */
  toDisplay(): string {
    const lines = [this.message];
    if (this.suggestion) lines.push(`\n  建议：${this.suggestion}`);
    if (this.raw) lines.push(`\n  原始错误：${this.raw}`);
    return lines.join('\n');
  }
}

export function classifyError(
  err: unknown,
  provider: AIProvider,
  envVars: string[],
  hasConfiguredKey = false,
): AICallError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Check if API key is missing from env before any call
  if (envVars.length > 0 && !hasConfiguredKey && !envVars.some(v => process.env[v])) {
    return new AICallError(
      'MISSING_API_KEY',
      provider,
      `缺少 ${provider} API Key`,
      `请设置环境变量 ${envVars.join(' 或 ')}，然后运行 ic provider test 验证。\n  PowerShell: $env:${envVars[0]}="sk-..."\n  Bash:       export ${envVars[0]}="sk-..."`,
      msg,
    );
  }

  // Authentication / authorization
  if (
    lower.includes('401') || lower.includes('403') ||
    lower.includes('unauthorized') || lower.includes('unauthenticated') ||
    lower.includes('invalid api key') || lower.includes('incorrect api key') ||
    lower.includes('invalid x-api-key') || lower.includes('authorization') ||
    lower.includes('authentication') || lower.includes('auth failed') ||
    lower.includes('not authorized')
  ) {
    const envHint = envVars.length > 0
      ? `\n  当前 Key 来源：环境变量 ${envVars.join(' / ')}`
      : '';
    return new AICallError(
      'AUTH_FAILED',
      provider,
      `${provider} API 鉴权失败 — 请检查 API Key 是否正确`,
      `1. 确认 ${envVars.join(' 或 ')} 的值是正确的\n  2. 检查 Key 是否过期或被撤销\n  3. 检查是否有权限访问模型${envHint}\n  4. 运行 ic provider test 重新验证`,
      msg,
    );
  }

  // Timeout
  if (
    lower.includes('timeout') || lower.includes('timed out') ||
    lower.includes('abort') || lower.includes('etimedout')
  ) {
    return new AICallError(
      'TIMEOUT',
      provider,
      `${provider} API 请求超时`,
      '1. 检查网络延迟\n  2. 简化任务或减少上下文大小\n  3. 稍后重试（服务器可能繁忙）\n  4. 考虑切换到更快的模型',
      msg,
    );
  }

  // Network errors (includes stream interruption)
  if (
    lower.includes('econnrefused') || lower.includes('enotfound') ||
    lower.includes('econnreset') || lower.includes('premature close') ||
    lower.includes('network') || lower.includes('fetch failed') ||
    lower.includes('connection') || lower.includes('dns') ||
    lower.includes('eai_again') || lower.includes('proxy') ||
    lower.includes('socket') || lower.includes('tls')
  ) {
    return new AICallError(
      'NETWORK_ERROR',
      provider,
      `${provider} API 网络连接失败 — 无法访问 API 端点`,
      '1. 检查网络连接是否正常\n  2. 检查是否需要配置代理 (HTTP_PROXY / HTTPS_PROXY)\n  3. 检查防火墙是否阻止了 API 域名\n  4. 尝试 curl 访问 API 端点验证连通性',
      msg,
    );
  }

  // Invalid model
  if (
    lower.includes('model') && (
      lower.includes('not found') || lower.includes('not exist') ||
      lower.includes('invalid') || lower.includes('unknown') ||
      lower.includes('does not') || lower.includes('no such')
    )
  ) {
    return new AICallError(
      'INVALID_MODEL',
      provider,
      `${provider} 模型不可用: ${msg.substring(0, 100)}`,
      `1. 运行 ic provider models ${provider} 查看可用模型\n  2. 运行 ic provider model <model-name> 切换到有效模型\n  3. 确认模型名称拼写正确`,
      msg,
    );
  }

  // Rate limit
  if (
    lower.includes('429') || lower.includes('rate limit') ||
    lower.includes('too many requests') || lower.includes('quota')
  ) {
    return new AICallError(
      'RATE_LIMITED',
      provider,
      `${provider} API 速率/配额限制`,
      '1. 等待 30-60 秒后重试\n  2. 检查账户配额是否用完\n  3. 考虑降低并发任务数',
      msg,
    );
  }

  // Generic provider error
  return new AICallError(
    'UNKNOWN',
    provider,
    `${provider} API 调用失败: ${msg.substring(0, 200)}`,
    '1. 检查 API Key 和网络\n  2. 运行 ic provider test 诊断\n  3. 查看原始错误信息定位问题',
    msg,
  );
}
