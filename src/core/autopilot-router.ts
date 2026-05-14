export type AutopilotIntent = 'none' | 'report' | 'docs' | 'tests' | 'test-write' | 'chain';

export interface AutopilotRoute {
  intent: AutopilotIntent;
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  requiresConfirmation: boolean;
}

export function routeAutopilotIntent(input: string): AutopilotRoute {
  const normalized = normalizeInput(input);
  if (!normalized) return none();

  if (matches(normalized, [
    /^(auto|autopilot|自动工程|工程自动驾驶)$/,
    /(自动|完整|全局|整个|全项目).*(执行链|研发链|工程链|任务链|思维链)/,
    /(思维链|执行链).*(自动|项目|工程|测试|写入|回滚)/,
  ])) {
    return route('chain', 'high', '用户要查看自动执行、发现问题、写入、验证、失败处理的工程链路。', false);
  }

  if (matches(normalized, [
    /(生成|补|补齐|补全|写|完善).*(测试|单测|test|spec)/,
    /(测试|单测|test|spec).*(生成|补|补齐|补全|写)/,
  ])) {
    return route('test-write', 'high', '用户要让系统自动生成缺失测试，需要写入文件前确认。', true);
  }

  if (matches(normalized, [
    /(检查|分析|规划|查看).*(测试|单测|覆盖|test|spec).*(缺口|情况|计划|覆盖)?/,
    /(测试|单测|覆盖|test|spec).*(缺口|计划|检查|分析|有哪些)/,
  ])) {
    return route('tests', 'high', '用户要分析测试覆盖缺口，不需要写入文件。', false);
  }

  if (matches(normalized, [
    /(补齐|补全|生成|写|完善|创建).*(文档|docs|prd|readme|architecture|api|testing)/,
    /(文档|docs|prd|readme|architecture|api|testing).*(补齐|补全|生成|写|完善|缺失|缺哪些)/,
  ])) {
    return route('docs', 'high', '用户要补齐缺失文档，需要写入文件前确认。', true);
  }

  // P7: Analysis queries now go to AI chat with rich context + tool calling,
  // not the static autopilot. The AI can do iterative exploration and produce
  // detailed analysis (like identifying tech stack, features, completeness).
  // Static autopilot is still available via `ic autopilot` CLI command.
  // (Removed the 'report' intent routing — analysis now goes through AI chat)

  return none();
}

function route(intent: AutopilotIntent, confidence: AutopilotRoute['confidence'], reason: string, requiresConfirmation: boolean): AutopilotRoute {
  return { intent, confidence, reason, requiresConfirmation };
}

function none(): AutopilotRoute {
  return { intent: 'none', confidence: 'low', reason: '未匹配到本地自动工程意图。', requiresConfirmation: false };
}

function normalizeInput(input: string): string {
  return input.trim().toLowerCase().replace(/[，。！？?！、]/g, ' ').replace(/s+/g, ' ');
}

function matches(input: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(input));
}
