import { describe, expect, it } from 'vitest';
import {
  C,
  B,
  I,
  termWidth,
  thinDivider,
  drawWideBox,
  notification,
  statusBar,
  processStep,
  agentCard,
  commandHelp,
  welcomeScreen,
} from '../src/cli/theme.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('theme constants', () => {
  it('C colors are callable functions', () => {
    expect(typeof C.primary).toBe('function');
    expect(typeof C.success).toBe('function');
    expect(typeof C.error).toBe('function');
    expect(typeof C.warn).toBe('function');
    expect(typeof C.dim).toBe('function');
    expect(typeof C.accent).toBe('function');
  });

  it('B contains box-drawing characters', () => {
    expect(B.tl).toBe('╭');
    expect(B.tr).toBe('╮');
    expect(B.bl).toBe('╰');
    expect(B.br).toBe('╯');
    expect(B.h).toBe('─');
    expect(B.v).toBe('│');
  });

  it('I icons are non-empty strings', () => {
    expect(strip(I.ok).length).toBeGreaterThan(0);
    expect(strip(I.err).length).toBeGreaterThan(0);
    expect(strip(I.running).length).toBeGreaterThan(0);
    expect(strip(I.warn).length).toBeGreaterThan(0);
  });
});

describe('termWidth', () => {
  it('returns a positive integer', () => {
    const w = termWidth();
    expect(typeof w).toBe('number');
    expect(w).toBeGreaterThan(0);
  });
});

describe('thinDivider', () => {
  it('returns a non-empty string with dash characters', () => {
    const div = strip(thinDivider());
    expect(div.length).toBeGreaterThan(0);
    expect(div).toMatch(/─+/);
  });
});

describe('drawWideBox', () => {
  it('wraps content in box characters', () => {
    const box = strip(drawWideBox('hello world'));
    expect(box).toContain('hello world');
    expect(box).toContain('╭');
    expect(box).toContain('╯');
  });

  it('includes title when provided', () => {
    const box = strip(drawWideBox('content', { title: 'My Box' }));
    expect(box).toContain('My Box');
    expect(box).toContain('content');
  });

  it('handles multi-line content', () => {
    const box = strip(drawWideBox('line1\nline2\nline3'));
    expect(box).toContain('line1');
    expect(box).toContain('line2');
    expect(box).toContain('line3');
  });
});

describe('notification', () => {
  it('renders success notification', () => {
    const out = strip(notification('操作完成', 'success'));
    expect(out).toContain('操作完成');
    expect(out).toContain('✓');
  });

  it('renders warn notification', () => {
    const out = strip(notification('注意事项', 'warn'));
    expect(out).toContain('注意事项');
    expect(out).toContain('⚠');
  });

  it('renders error notification', () => {
    const out = strip(notification('出错了', 'error'));
    expect(out).toContain('出错了');
    expect(out).toContain('✗');
  });

  it('defaults to info type', () => {
    const out = strip(notification('提示信息'));
    expect(out).toContain('提示信息');
    expect(out).toContain('●');
  });
});

describe('statusBar', () => {
  it('renders all items', () => {
    const out = strip(statusBar([
      { label: '状态', value: 'running', color: 'primary' },
      { label: '任务', value: '3', color: 'accent' },
      { label: '测试', value: 'pass', color: 'success' },
      { label: '警告', value: '1', color: 'warn' },
    ]));
    expect(out).toContain('状态');
    expect(out).toContain('running');
    expect(out).toContain('任务');
    expect(out).toContain('3');
  });

  it('renders items with no color', () => {
    const out = strip(statusBar([{ label: 'X', value: 'Y' }]));
    expect(out).toContain('X');
    expect(out).toContain('Y');
  });
});

describe('processStep', () => {
  it('renders done step with ok icon', () => {
    const out = strip(processStep(1, 5, '编译', 'done'));
    expect(out).toContain('[1/5]');
    expect(out).toContain('编译');
    expect(out).toContain('✓');
  });

  it('renders fail step with error icon', () => {
    const out = strip(processStep(2, 5, '测试', 'fail'));
    expect(out).toContain('[2/5]');
    expect(out).toContain('测试');
    expect(out).toContain('✗');
  });

  it('renders running step', () => {
    const out = strip(processStep(3, 5, '运行', 'running'));
    expect(out).toContain('[3/5]');
    expect(out).toContain('运行');
  });

  it('defaults to pending', () => {
    const out = strip(processStep(4, 5, '等待'));
    expect(out).toContain('[4/5]');
    expect(out).toContain('等待');
  });
});

describe('agentCard', () => {
  it('renders running agent with all fields', () => {
    const out = strip(agentCard({
      id: 'agent-12345678',
      type: 'code',
      status: 'running',
      desc: '生成用户模块',
      elapsed: 2500,
      tokens: 1500,
    }));
    expect(out).toContain('agent-12345');
    expect(out).toContain('code');
    expect(out).toContain('running');
    expect(out).toContain('生成用户模块');
    expect(out).toContain('2.5s');
    expect(out).toContain('1,500');
  });

  it('renders done agent', () => {
    const out = strip(agentCard({ id: 'x', type: 'test', status: 'done' }));
    expect(out).toContain('done');
    expect(out).toContain('✓');
  });

  it('renders failed agent', () => {
    const out = strip(agentCard({ id: 'x', type: 'test', status: 'failed' }));
    expect(out).toContain('failed');
    expect(out).toContain('✗');
  });

  it('renders agent without optional fields', () => {
    const out = strip(agentCard({ id: 'y', type: 'scan', status: 'pending' }));
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('commandHelp', () => {
  it('contains known commands', () => {
    const out = strip(commandHelp());
    expect(out).toContain('/help');
    expect(out).toContain('/scan');
    expect(out).toContain('/verify');
    expect(out).toContain('/commit');
    expect(out).toContain('/exit');
  });

  it('contains keyboard shortcut hints', () => {
    const out = strip(commandHelp());
    expect(out).toContain('y=确认');
  });
});

describe('welcomeScreen', () => {
  it('contains provider and model info', () => {
    const out = strip(welcomeScreen('Claude', 'claude-3-opus'));
    expect(out).toContain('Claude');
    expect(out).toContain('claude-3-opus');
    expect(out).toContain('i C l o s e r');
  });

  it('shows project name when provided', () => {
    const out = strip(welcomeScreen('Mock', 'mock-model', 'my-project'));
    expect(out).toContain('my-project');
  });

  it('renders onboarding steps when provided', () => {
    const out = strip(welcomeScreen('Mock', 'mock', undefined, ['Step 1: init', 'Step 2: scan']));
    expect(out).toContain('Step 1: init');
    expect(out).toContain('Step 2: scan');
  });
});
