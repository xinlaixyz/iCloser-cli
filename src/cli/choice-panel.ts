import { C, termWidth } from './theme.js';

export interface ChoiceOption {
  id: number;
  label: string;
  description?: string;
}

export interface ChoicePanel {
  title: string;
  subtitle?: string;
  bodyLines?: string[];
  options: ChoiceOption[];
  hint?: string;
  allowMultiple?: boolean;
}

export function renderChoicePanel(panel: ChoicePanel): string {
  const width = Math.min(termWidth() - 4, 76);
  const border = C.dim('─'.repeat(Math.max(24, width)));
  const lines: string[] = [''];

  lines.push(`  ${C.primary(panel.title)}${panel.subtitle ? ` ${C.dim(panel.subtitle)}` : ''}`);
  lines.push(`  ${border}`);

  for (const line of panel.bodyLines || []) {
    lines.push(line.trim() ? `  ${line}` : '');
  }

  if ((panel.bodyLines || []).length > 0) lines.push('');
  lines.push(`  ${C.bright('请选择下一步')}`);
  for (const option of panel.options) {
    const desc = option.description ? ` ${C.dim(option.description)}` : '';
    lines.push(`  ${C.accent(`[${option.id}]`)} ${option.label}${desc}`);
  }
  lines.push(`  ${border}`);
  lines.push(`  ${C.dim(panel.hint || defaultChoiceHint(panel.allowMultiple))}`);
  return `${lines.join('\n')}\n`;
}

export function defaultChoiceHint(allowMultiple = false): string {
  if (allowMultiple) return '下面输入框只接受选项数字，多个选项可输入 1和2 或 1,2；不用输入命令。';
  return '下面输入框只接受选项数字，回车确认；不用输入命令。';
}

export function choicePrompt(panel: Pick<ChoicePanel, 'options' | 'allowMultiple'>): string {
  const values = panel.options.map(option => option.id).join('/');
  const suffix = panel.allowMultiple ? ' 可多选' : '';
  return `${C.accent('选择')} ${C.dim(`${values}${suffix}`)} ${C.accent('>')} `;
}

export function parseChoiceInput(input: string, optionCount: number, allowMultiple = false): number[] {
  const raw = input.trim().toLowerCase();
  if (!raw) return [];

  if (allowMultiple && isAllChoice(raw)) {
    return Array.from({ length: optionCount }, (_, index) => index);
  }

  const normalized = raw
    .replace(/[，、]/g, ',')
    .replace(/\s*(和|与|及|and|&|\+)\s*/g, ',')
    .replace(/\s+/g, ',');

  if (!/^\d+([,\-]\d+)*$/.test(normalized)) return [];
  if (!allowMultiple && !/^\d+$/.test(normalized)) return [];

  const selected = new Set<number>();
  for (const part of normalized.split(',').filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      if (!allowMultiple) return [];
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start <= 0 || end <= 0) return [];
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let value = min; value <= max; value++) {
        if (value > optionCount) return [];
        selected.add(value - 1);
      }
      continue;
    }

    const value = Number(part);
    if (!Number.isInteger(value) || value <= 0 || value > optionCount) return [];
    selected.add(value - 1);
  }

  return [...selected].sort((a, b) => a - b);
}

function isAllChoice(input: string): boolean {
  return ['all', 'a', '全部', '全选', '都写', '全部写入', '写入全部'].includes(input);
}
// icloser mock edit: S13验收：用一句话介绍icloser
