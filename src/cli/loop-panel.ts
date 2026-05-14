import { getStepToolCapabilities } from '../core/tool-registry.js';
import type { TaskLoopStepId } from '../core/task-loop.js';
import { buildTaskThinkingLoop } from '../core/task-loop.js';
import { C, drawWideBox } from './theme.js';

const loop = buildTaskThinkingLoop();

export interface ReplLoopPanelOptions {
  title?: string;
  subtitle?: string;
  iteration?: number;
  webSearchAvailable?: boolean;
  codeIntelligenceAvailable?: boolean;
  commandAvailable?: boolean;
}

const NEXT_STEP: Record<TaskLoopStepId, string> = {
  'collect-context': '执行操作',
  'take-action': '验证结果',
  'verify-result': '任务结束 / 继续下一轮',
};

const STEP_NAME: Record<TaskLoopStepId, string> = {
  'collect-context': '收集上下文',
  'take-action': '执行操作',
  'verify-result': '验证结果',
};

const STEP_ORDER: TaskLoopStepId[] = ['collect-context', 'take-action', 'verify-result'];

export function renderReplLoopPanel(stepId: TaskLoopStepId, options: ReplLoopPanelOptions = {}): string {
  const capabilities = getStepToolCapabilities(stepId, options);
  const stepIndex = STEP_ORDER.indexOf(stepId);
  const iter = options.iteration || 1;

  const toolLine = capabilities.map(tool => {
    if (tool.status === 'available') return C.success(tool.name);
    if (tool.status === 'limited') return C.warn(tool.name) + C.warn('(降级)');
    return C.error(tool.name) + C.error('(不可用)');
  }).join(C.dim(' / '));

  const degraded = capabilities.filter(tool => tool.status !== 'available');
  const step = loop.steps.find(s => s.id === stepId);

  const lines = [
    `${C.dim('步骤')} ${C.accent(String(stepIndex + 1))}${C.dim('/' + STEP_ORDER.length)}  ${C.accent(STEP_NAME[stepId])}  ${C.dim('第' + iter + '轮')}`,
    `${C.dim('使用')}  ${toolLine}`,
    `${C.dim('之后')}  ${C.bright(NEXT_STEP[stepId])}`,
  ];

  if (step) lines.unshift(C.dim(step.purpose.slice(0, 64) + (step.purpose.length > 64 ? '…' : '')));
  if (options.subtitle) lines.unshift(C.dim(options.subtitle));
  if (degraded.length > 0) {
    lines.push('');
    for (const tool of degraded) {
      lines.push(`${C.warn('降级')} ${tool.name}：${C.muted(tool.fallback)}`);
    }
  }

  return drawWideBox(lines.join('\n'), { title: options.title || '任务循环' });
}

export function renderReplLoopStatusBar(stepId: TaskLoopStepId, options: ReplLoopPanelOptions = {}): string {
  const capabilities = getStepToolCapabilities(stepId, options);
  const stepIndex = STEP_ORDER.indexOf(stepId);
  const iter = options.iteration || 1;
  const degradedCount = capabilities.filter(c => c.status !== 'available').length;
  const degradedNote = degradedCount > 0 ? C.warn(` ${degradedCount}项降级`) : '';

  return `  ${C.accent('◉')} ${C.accent(STEP_NAME[stepId])} ${C.dim('(' + (stepIndex + 1) + '/' + STEP_ORDER.length + ' 第' + iter + '轮)')}${degradedNote}`;
}

export function isLoopInterventionInput(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return false;
  return [
    '换个方法',
    '换个方法试试',
    '换一种方法',
    '换方法',
    '暂停',
    '暂停任务',
    '中断',
    '中断任务',
    '停止',
    '停止任务',
    '不要这样',
    '只看分析不执行',
    '先别执行',
    '先不要执行',
    '不做了',
    '取消',
    'tryanotherway',
    'pause',
    'interrupt',
  ].some(keyword => normalized.includes(keyword));
}

export function renderLoopInterventionNotice(input: string): string {
  return drawWideBox([
    `${C.dim('用户干预')} ${C.accent(input)}`,
    `${C.dim('处理方式')} 已停止当前执行方向，回到收集上下文。`,
    `${C.dim('下一步')} 你可以补充信息、调整目标，或重新输入任务。`,
  ].join('\n'), { title: '用户干预' });
}

