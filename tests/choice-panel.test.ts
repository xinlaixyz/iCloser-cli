import { describe, expect, it } from 'vitest';
import { parseChoiceInput, renderChoicePanel } from '../src/cli/choice-panel.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('choice panel', () => {
  it('renders Chinese choice panel with numeric options', () => {
    const text = stripAnsi(renderChoicePanel({
      title: '系统权限确认',
      subtitle: '需要执行 PowerShell 命令',
      bodyLines: ['命令 npm run dev', '影响 会启动本地开发服务。'],
      options: [
        { id: 1, label: '允许执行一次' },
        { id: 2, label: '取消' },
      ],
    }));

    expect(text).toContain('系统权限确认');
    expect(text).toContain('请选择下一步');
    expect(text).toContain('[1] 允许执行一次');
    expect(text).toContain('[2] 取消');
    expect(text).toContain('下面输入框只接受选项数字');
  });

  it('parses single-choice input strictly', () => {
    expect(parseChoiceInput('1', 3)).toEqual([0]);
    expect(parseChoiceInput('3', 3)).toEqual([2]);
    expect(parseChoiceInput('1和2', 3)).toEqual([]);
    expect(parseChoiceInput('4', 3)).toEqual([]);
    expect(parseChoiceInput('启动项目', 3)).toEqual([]);
  });

  it('parses multi-choice input when enabled', () => {
    expect(parseChoiceInput('1和2', 4, true)).toEqual([0, 1]);
    expect(parseChoiceInput('1-3', 4, true)).toEqual([0, 1, 2]);
    expect(parseChoiceInput('全部', 3, true)).toEqual([0, 1, 2]);
  });
});
