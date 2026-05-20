import { describe, expect, it } from 'vitest';
import {
  renderBottomPanel,
  buildFileOptions,
  buildConfirmOptions,
  contextMeterItem,
  TuiScreen,
  DEFAULT_SHORTCUTS,
} from '../src/cli/tui.js';

describe('renderBottomPanel', () => {
  it('renders panel title and items', () => {
    const out = renderBottomPanel({
      type: 'status',
      title: '状态',
      items: [
        { label: '编译', status: 'ok' },
        { label: '测试', status: 'fail', detail: '3 errors' },
        { label: '运行中', status: 'running' },
        { label: '等待', checked: true },
      ],
      actions: [{ key: 'r', label: '重试', action: 'retry' }],
    });
    expect(out).toContain('状态');
    expect(out).toContain('编译');
    expect(out).toContain('测试');
    expect(out).toContain('3 errors');
  });

  it('renders panel with no items', () => {
    const out = renderBottomPanel({
      type: 'shortcuts',
      title: '快捷键',
      items: [],
      actions: [{ key: 'h', label: '帮助', action: 'help' }],
    });
    expect(out).toContain('快捷键');
    expect(out).toContain('帮助');
  });

  it('renders panel with no actions', () => {
    const out = renderBottomPanel({
      type: 'files',
      title: '文件',
      items: [{ label: 'src/index.ts', status: 'pending' }],
      actions: [],
    });
    expect(out).toContain('src/index.ts');
    expect(typeof out).toBe('string');
  });
});

describe('buildFileOptions', () => {
  it('maps files to TuiOptions with correct keys', () => {
    const opts = buildFileOptions([
      { path: 'src/a.ts', lines: 10 },
      { path: 'src/b.ts', lines: 20 },
    ]);
    expect(opts).toHaveLength(2);
    expect(opts[0].key).toBe('1');
    expect(opts[0].label).toBe('src/a.ts');
    expect(opts[0].desc).toBe('+10 行');
    expect(opts[0].action).toBe('write');
    expect(opts[1].key).toBe('2');
  });

  it('returns empty array for empty input', () => {
    expect(buildFileOptions([])).toEqual([]);
  });
});

describe('buildConfirmOptions', () => {
  it('returns 3 options with correct keys', () => {
    const opts = buildConfirmOptions('task-abc');
    expect(opts).toHaveLength(3);
    expect(opts.map(o => o.key)).toEqual(['y', 'n', 'e']);
    expect(opts[0].action).toBe('confirm');
    expect(opts[1].action).toBe('reject');
    expect(opts[2].action).toBe('edit');
    expect(opts[0].desc).toBe('task-abc');
  });
});

describe('contextMeterItem', () => {
  it('returns ok status for low context usage', () => {
    const item = contextMeterItem(1000, 10000);
    expect(item.status).toBe('ok');
    expect(item.label).toContain('上下文');
  });

  it('returns pending status for 60% usage', () => {
    const item = contextMeterItem(6000, 10000);
    expect(item.status).toBe('pending');
  });

  it('returns fail status for >80% usage', () => {
    const item = contextMeterItem(9000, 10000);
    expect(item.status).toBe('fail');
  });

  it('clamps at 100%', () => {
    const item = contextMeterItem(20000, 10000);
    expect(item.label).toContain('██████████');
    expect(item.status).toBe('fail');
  });
});

describe('TuiScreen', () => {
  it('getSelected returns null when no options set', () => {
    const screen = new TuiScreen();
    expect(screen.getSelected()).toBeNull();
  });

  it('setOptions and getSelected return first option', () => {
    const screen = new TuiScreen();
    screen.setOptions([
      { key: 'w', label: '写入', action: 'write' },
      { key: 'n', label: '取消', action: 'cancel' },
    ]);
    const sel = screen.getSelected();
    expect(sel).not.toBeNull();
    expect(sel!.key).toBe('w');
  });

  it('navDown advances selection and wraps around', () => {
    const screen = new TuiScreen();
    screen.setOptions([
      { key: '1', label: 'A', action: 'a' },
      { key: '2', label: 'B', action: 'b' },
    ]);
    screen.navDown();
    expect(screen.getSelected()!.key).toBe('2');
    screen.navDown();
    expect(screen.getSelected()!.key).toBe('1');
  });

  it('navUp wraps to last item from first', () => {
    const screen = new TuiScreen();
    screen.setOptions([
      { key: '1', label: 'A', action: 'a' },
      { key: '2', label: 'B', action: 'b' },
    ]);
    screen.navUp();
    expect(screen.getSelected()!.key).toBe('2');
  });

  it('clearOptions resets selection', () => {
    const screen = new TuiScreen();
    screen.setOptions([{ key: 'x', label: 'X', action: 'x' }]);
    screen.clearOptions();
    expect(screen.getSelected()).toBeNull();
  });

  it('setStatus and renderFull produce non-empty output', () => {
    const screen = new TuiScreen();
    screen.setStatus('Ready');
    const out = screen.renderFull();
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('renderFull includes option labels when set', () => {
    const screen = new TuiScreen();
    screen.setOptions([
      { key: 'w', label: '写入文件', action: 'write', desc: 'src/a.ts' },
    ], '按 w 确认');
    const out = screen.renderFull();
    expect(out).toContain('写入文件');
    expect(out).toContain('src/a.ts');
  });
});

describe('DEFAULT_SHORTCUTS', () => {
  it('has type shortcuts and actions', () => {
    expect(DEFAULT_SHORTCUTS.type).toBe('shortcuts');
    expect(DEFAULT_SHORTCUTS.actions.length).toBeGreaterThan(0);
    expect(DEFAULT_SHORTCUTS.items).toHaveLength(0);
  });
});
