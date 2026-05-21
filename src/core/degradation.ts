// FIX-06: Degradation message module — standardised Chinese tiered format
// All user-facing degradation/fallback notices go through here for consistency.

// ─── Types ────────────────────────────────────────────────────────────────────

/** Severity tier matching the three-tier CI model */
export type DegradeTier = 'minor' | 'moderate' | 'severe';

export interface DegradeMessage {
  /** Machine-readable scenario key */
  scenario: string;
  /** Primary Chinese description shown to the user */
  title: string;
  /** One-line cause hint */
  cause?: string;
  /** Suggested recovery action */
  action?: string;
  /** Severity tier */
  tier: DegradeTier;
}

// ─── Tier labels (Chinese) ────────────────────────────────────────────────────

const TIER_LABEL: Record<DegradeTier, string> = {
  minor:    '⚡ 轻微降级',
  moderate: '⚠️  中度降级',
  severe:   '🔴 严重降级',
};

// ─── Pre-defined scenarios ────────────────────────────────────────────────────

/** Provider / AI model unreachable */
export function providerUnavailable(detail?: string): DegradeMessage {
  return {
    scenario: 'provider_unavailable',
    tier: 'moderate',
    title: 'AI Provider 暂不可用',
    cause: detail ?? '连接失败或 API Key 无效',
    action: '运行 ic provider doctor 诊断，或执行 ic provider key <your-key> 更新密钥',
  };
}

/** Network request failed (timeout / no connectivity) */
export function networkFailure(detail?: string): DegradeMessage {
  return {
    scenario: 'network_failure',
    tier: 'moderate',
    title: '网络请求失败',
    cause: detail ?? '请求超时或无网络连接',
    action: '检查网络连接后重试，或使用 --offline 模式',
  };
}

/** File system operation failed */
export function fileSystemDegradation(path?: string, detail?: string): DegradeMessage {
  return {
    scenario: 'filesystem_error',
    tier: 'severe',
    title: '文件系统操作失败',
    cause: (path ? `路径 ${path}: ` : '') + (detail ?? '权限不足或磁盘空间不足'),
    action: '检查文件权限和磁盘空间，或以管理员权限重试',
  };
}

/** External tool / binary not available */
export function toolUnavailable(toolName: string, detail?: string): DegradeMessage {
  return {
    scenario: 'tool_unavailable',
    tier: 'minor',
    title: `外部工具 ${toolName} 不可用`,
    cause: detail ?? `${toolName} 未安装或不在 PATH 中`,
    action: `安装 ${toolName} 后重试，或跳过此步骤`,
  };
}

/** Memory / context system degraded */
export function memoryDegradation(detail?: string): DegradeMessage {
  return {
    scenario: 'memory_degradation',
    tier: 'minor',
    title: '记忆系统降级运行',
    cause: detail ?? '记忆初始化失败',
    action: '可继续使用，记忆功能将在下次成功初始化后恢复',
  };
}

/** Git operations unavailable */
export function gitUnavailable(detail?: string): DegradeMessage {
  return {
    scenario: 'git_unavailable',
    tier: 'minor',
    title: 'Git 功能不可用',
    cause: detail ?? '当前目录不是 Git 仓库或 git 未安装',
    action: '在 git 仓库中运行，或忽略 git 相关功能',
  };
}

/** AI response parse / contract failure */
export function aiOutputError(detail?: string): DegradeMessage {
  return {
    scenario: 'ai_output_error',
    tier: 'minor',
    title: 'AI 响应解析失败',
    cause: detail ?? 'AI 输出不符合预期格式',
    action: '已回退到安全默认值；如持续出现请更换模型或重试',
  };
}

/** Build / compile step failed */
export function buildFailure(detail?: string): DegradeMessage {
  return {
    scenario: 'build_failure',
    tier: 'moderate',
    title: '构建/编译失败',
    cause: detail ?? '代码存在编译错误',
    action: '修复编译错误后重试，或运行 ic verify 查看详情',
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Format a degradation message for console output.
 * Returns a multi-line string with tier badge, title, cause and action.
 */
export function formatDegrade(msg: DegradeMessage): string {
  const lines: string[] = [];
  lines.push(`  ${TIER_LABEL[msg.tier]}  ${msg.title}`);
  if (msg.cause)  lines.push(`  原因: ${msg.cause}`);
  if (msg.action) lines.push(`  建议: ${msg.action}`);
  return lines.join('\n');
}

/**
 * Compact single-line format: "[tier] title — cause"
 * Useful for log lines where brevity matters.
 */
export function formatDegradeCompact(msg: DegradeMessage): string {
  const badge = TIER_LABEL[msg.tier];
  const cause = msg.cause ? ` — ${msg.cause}` : '';
  return `${badge}  ${msg.title}${cause}`;
}

/**
 * Print degradation to console.warn with appropriate formatting.
 */
export function warnDegrade(msg: DegradeMessage): void {
  console.warn(formatDegrade(msg));
}

/**
 * Emit a degradation event + return a formatted string.
 * Convenience wrapper combining formatDegrade with an optional callback.
 */
export function degrade(
  factory: () => DegradeMessage,
  opts?: { onDegrade?: (msg: DegradeMessage) => void },
): string {
  const msg = factory();
  opts?.onDegrade?.(msg);
  return formatDegrade(msg);
}
