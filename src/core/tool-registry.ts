import { buildTaskThinkingLoop, type TaskLoopStepId, type TaskLoopToolCategory, type TaskLoopToolCategoryId } from './task-loop.js';

export type ToolCapabilityStatus = 'available' | 'limited' | 'unavailable';

export interface ToolCapability {
  id: TaskLoopToolCategoryId;
  name: string;
  status: ToolCapabilityStatus;
  availability: TaskLoopToolCategory['availability'];
  purpose: string;
  examples: string[];
  safetyRule: string;
  fallback: string;
  reason: string;
}

export interface ToolCapabilitySnapshot {
  generatedAt: string;
  capabilities: ToolCapability[];
}

export interface ToolRegistryOptions {
  webSearchAvailable?: boolean;
  codeIntelligenceAvailable?: boolean;
  commandAvailable?: boolean;
}

export function buildToolCapabilitySnapshot(options: ToolRegistryOptions = {}): ToolCapabilitySnapshot {
  const loop = buildTaskThinkingLoop();
  return {
    generatedAt: new Date().toISOString(),
    capabilities: loop.toolCategories.map(category => toCapability(category, options)),
  };
}

export function getToolCapability(id: TaskLoopToolCategoryId, options: ToolRegistryOptions = {}): ToolCapability {
  const capability = buildToolCapabilitySnapshot(options).capabilities.find(item => item.id === id);
  if (!capability) throw new Error(`未知工具能力：${id}`);
  return capability;
}

export function getStepToolCapabilities(stepId: TaskLoopStepId, options: ToolRegistryOptions = {}): ToolCapability[] {
  const loop = buildTaskThinkingLoop();
  const step = loop.steps.find(item => item.id === stepId);
  if (!step) throw new Error(`未知循环步骤：${stepId}`);
  const snapshot = buildToolCapabilitySnapshot(options);
  return step.requiredToolCategories.map(id => {
    const capability = snapshot.capabilities.find(item => item.id === id);
    if (!capability) throw new Error(`循环步骤 ${stepId} 缺少工具能力：${id}`);
    return capability;
  });
}

export function renderStepToolStatus(stepId: TaskLoopStepId, options: ToolRegistryOptions = {}): string {
  const loop = buildTaskThinkingLoop();
  const step = loop.steps.find(item => item.id === stepId);
  const capabilities = getStepToolCapabilities(stepId, options);
  const lines: string[] = [];
  lines.push(`${step?.name || stepId} 工具状态`);
  for (const capability of capabilities) {
    lines.push(`- ${capability.name}：${formatStatus(capability.status)}（${capability.reason}）`);
    if (capability.status !== 'available') lines.push(`  降级：${capability.fallback}`);
  }
  return lines.join('\n');
}

export function renderToolFallbackSummary(options: ToolRegistryOptions = {}): string {
  const snapshot = buildToolCapabilitySnapshot(options);
  const degraded = snapshot.capabilities.filter(item => item.status !== 'available');
  if (degraded.length === 0) return '五大工具能力均可用。';
  return degraded.map(item => `${item.name}暂不可用或受限，已降级为：${item.fallback}`).join('\n');
}

function toCapability(category: TaskLoopToolCategory, options: ToolRegistryOptions): ToolCapability {
  if (category.id === 'web-search') {
    // DuckDuckGo is free and zero-config → assumed available until proven otherwise
    const available = options.webSearchAvailable !== false;
    return {
      ...base(category),
      status: available ? 'available' : 'limited',
      reason: available ? '网络搜索可用（DuckDuckGo）' : '网络搜索暂不可用，使用本地文档',
    };
  }

  if (category.id === 'code-intelligence') {
    const available = options.codeIntelligenceAvailable !== false;
    return {
      ...base(category),
      status: available ? 'available' : 'limited',
      reason: available ? '内置 tree-sitter AST 解析器可用' : 'tree-sitter AST 不可用，使用降级策略',
    };
  }

  if (category.id === 'command') {
    const available = options.commandAvailable !== false;
    return {
      ...base(category),
      status: available ? 'available' : 'unavailable',
      reason: available ? '本地命令能力可用，但受权限确认控制' : '本地命令能力不可用',
    };
  }

  return {
    ...base(category),
    status: 'available',
    reason: '内置能力可用',
  };
}

function base(category: TaskLoopToolCategory): Omit<ToolCapability, 'status' | 'reason'> {
  return {
    id: category.id,
    name: category.name,
    availability: category.availability,
    purpose: category.purpose,
    examples: category.examples,
    safetyRule: category.safetyRule,
    fallback: category.fallback,
  };
}

function formatStatus(status: ToolCapabilityStatus): string {
  if (status === 'available') return '可用';
  if (status === 'limited') return '受限';
  return '不可用';
}
