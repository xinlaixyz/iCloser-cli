// Terminal UI engine — multi-pane layout with keyboard navigation
import chalk from 'chalk';
import { C, I, B, termWidth, thinDivider } from './theme.js';

// ============================================================
// Bottom Panel (S20.3)
// ============================================================
export interface PanelItem {
  key?: string;
  label: string;
  detail?: string;
  status?: 'ok' | 'fail' | 'running' | 'pending';
  checked?: boolean;
}

export interface PanelAction {
  key: string;
  label: string;
  action: string;
}

export type PanelType = 'shortcuts' | 'files' | 'status' | 'verify';

export interface BottomPanelState {
  type: PanelType;
  title: string;
  items: PanelItem[];
  actions: PanelAction[];
}

export function renderBottomPanel(panel: BottomPanelState): string {
  const tw = termWidth();
  const w = tw - 4;
  let out = '';

  out += `\n  ${C.dim('╭─')} ${C.accent(panel.title)} ${C.dim('─'.repeat(Math.max(0, w - panel.title.length - 5)) + '╮')}\n`;

  // Items
  for (const item of panel.items) {
    const marker = item.status === 'ok' ? I.ok : item.status === 'fail' ? I.err :
      item.status === 'running' ? I.running : item.checked ? I.ok : C.dim('○');
    out += `  ${C.dim('│')} ${marker} ${C.accent(item.label)}`;
    if (item.detail) out += ` ${C.dim(item.detail)}`;
    out += '\n';
  }

  // Actions
  if (panel.actions.length > 0 && panel.items.length > 0) {
    out += `  ${C.dim('├─')} ${C.dim('─'.repeat(w))}${C.dim('┤')}\n`;
  }
  if (panel.actions.length > 0) {
    const actionStr = panel.actions.map(a =>
      `${C.accent(`[${a.key}]`)} ${C.dim(a.label)}`
    ).join(`  ${C.dim('│')}  `);
    out += `  ${C.dim('│')} ${actionStr}${' '.repeat(Math.max(0, w - stripAnsiLen(actionStr) - 2))} ${C.dim('│')}\n`;
  }

  out += `  ${C.dim('╰')}${C.dim('─'.repeat(w))}${C.dim('╯')}`;
  return out;
}

function stripAnsiLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export const DEFAULT_SHORTCUTS: BottomPanelState = {
  type: 'shortcuts',
  title: '操作',
  items: [],
  actions: [
    { key: 'h', label: '/help', action: 'help' },
    { key: 's', label: '/scan', action: 'scan' },
    { key: 'd', label: '/diff', action: 'diff' },
    { key: 'c', label: '/clear', action: 'clear' },
  ],
};

// ============================================================
// Screen layout
// ============================================================
export interface TuiLayout {
  chatLines: string[];         // scrollable chat history
  inputLine: string;           // current input text
  cursorPos: number;           // cursor position in input
  options: TuiOption[];        // selectable items below input
  selectedIdx: number;         // currently highlighted option index
  hint: string;                // shortcut hint text
  statusText: string;          // top status bar
}

export interface TuiOption {
  key: string;                 // shortcut key (e.g., 'w' for write)
  label: string;               // display label
  desc?: string;               // extra info (dim)
  action: string;              // what happens when selected
  selected?: boolean;          // checkmark state
}

// ============================================================
// Screen manager
// ============================================================
export class TuiScreen {
  private options: TuiOption[] = [];
  private selectedIdx = 0;
  private hint = '';
  private statusText = '';
  private lastRenderLineCount = 0;
  public enabled = false;

  // Set selectable options (shows below input)
  setOptions(opts: TuiOption[], hint?: string): void {
    this.options = opts;
    this.selectedIdx = 0;
    this.hint = hint || '';
  }

  // Clear options pane
  clearOptions(): void {
    this.options = [];
    this.selectedIdx = 0;
    this.hint = '';
  }

  // Set top status
  setStatus(text: string): void {
    this.statusText = text;
  }

  // Get currently selected option
  getSelected(): TuiOption | null {
    if (this.options.length === 0) return null;
    return this.options[this.selectedIdx] || null;
  }

  // Navigate up
  navUp(): void {
    if (this.options.length === 0) return;
    this.selectedIdx = (this.selectedIdx - 1 + this.options.length) % this.options.length;
    this.renderOptionsPane();
  }

  // Navigate down
  navDown(): void {
    if (this.options.length === 0) return;
    this.selectedIdx = (this.selectedIdx + 1) % this.options.length;
    this.renderOptionsPane();
  }

  // Render just the options pane (for keyboard nav updates)
  renderOptionsPane(): void {
    if (!this.enabled) return;
    const tw = termWidth();

    // Move to options area and clear previous
    const optLines = this.options.length + 3; // divider + options + hint + divider
    process.stdout.write('\x1b[0J'); // Clear from cursor to end of screen

    let out = '';
    out += `\n  ${C.dim('─'.repeat(tw - 4))}\n`;

    for (let i = 0; i < this.options.length; i++) {
      const opt = this.options[i];
      const isSelected = i === this.selectedIdx;
      const marker = opt.selected ? I.ok : (isSelected ? C.accent('●') : C.dim('○'));
      const label = isSelected ? chalk.bold(C.accent(opt.label)) : C.dim(opt.label);
      const desc = opt.desc ? ` ${C.dim(opt.desc)}` : '';
      out += `  ${marker} ${label}${desc}\n`;
    }

    if (this.hint) {
      out += `\n  ${C.dim(this.hint)}\n`;
    }
    out += `  ${C.dim('─'.repeat(tw - 4))}`;
    process.stdout.write(out);
  }

  // Render the full options pane (first time)
  renderFull(): string {
    const tw = termWidth();
    let out = '';

    out += `\n  ${C.dim('─'.repeat(tw - 4))}\n`;

    if (this.options.length > 0) {
      for (let i = 0; i < this.options.length; i++) {
        const opt = this.options[i];
        const isSelected = i === this.selectedIdx;
        const marker = opt.selected ? I.ok : (isSelected ? C.accent('●') : C.dim('○'));
        const label = isSelected ? chalk.bold(C.accent(opt.label)) : C.dim(opt.label);
        const desc = opt.desc ? ` ${C.dim(opt.desc)}` : '';
        out += `  ${marker} ${label}${desc}\n`;
      }
    } else {
      // Show default shortcuts when no active options
      out += `  ${TUI_SHORTCUTS}\n`;
    }

    if (this.hint) {
      out += `\n  ${C.dim(this.hint)}\n`;
    }
    out += `  ${C.dim('─'.repeat(tw - 4))}`;
    return out;
  }
}

// ============================================================
// Default shortcuts
// ============================================================
const TUI_SHORTCUTS = [
  `${C.accent('/help')}${C.dim(' 帮助')}`,
  `${C.accent('/scan')}${C.dim(' 扫描')}`,
  `${C.accent('/verify')}${C.dim(' 验证')}`,
  `${C.accent('/write')}${C.dim(' 写入')}`,
  `${C.accent('/diff')}${C.dim(' 预览')}`,
  `${C.accent('/test')}${C.dim(' 测试')}`,
  `${C.accent('/commit')}${C.dim(' 提交')}`,
  `${C.accent('/clear')}${C.dim(' 清屏')}`,
].join(`  ${C.dim('│')}  `);

// ============================================================
// Build file-action options from pending files
// ============================================================
export function buildFileOptions(files: { path: string; lines: number }[]): TuiOption[] {
  return files.map((f, i) => ({
    key: String(i + 1),
    label: f.path,
    desc: `+${f.lines} 行`,
    action: 'write',
    selected: true,
  }));
}

// ============================================================
// Build confirm/reject options
// ============================================================
export function buildConfirmOptions(taskId: string): TuiOption[] {
  return [
    { key: 'y', label: '确认执行', desc: taskId, action: 'confirm', selected: false },
    { key: 'n', label: '取消任务', desc: taskId, action: 'reject', selected: false },
    { key: 'e', label: '编辑方案', desc: '', action: 'edit', selected: false },
  ];
}
