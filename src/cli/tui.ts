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

  // Divider + actions
  if (panel.actions.length > 0) {
    out += `  ${C.dim('├─')} ${C.dim('操作')} ${C.dim('─'.repeat(Math.max(0, w - 8)) + '┤')}\n`;
    const actionStr = panel.actions.map(a =>
      `${C.accent(`[${a.key}]`)} ${C.dim(a.label)}`
    ).join(`  ${C.dim('│')}  `);
    out += `  ${C.dim('│')} ${actionStr}${' '.repeat(Math.max(0, w - actionStr.length - 2))} ${C.dim('│')}\n`;
  }

  out += `  ${C.dim('╰')}${C.dim('─'.repeat(w))}${C.dim('╯')}`;
  return out;
}

export const DEFAULT_SHORTCUTS: BottomPanelState = {
  type: 'shortcuts',
  title: '操作',
  items: [],
  actions: [
    { key: 'h', label: '帮助 /help', action: 'help' },
    { key: 's', label: '扫描 /scan', action: 'scan' },
    { key: 'w', label: '写入 /write', action: 'write' },
    { key: 'd', label: '预览 /diff', action: 'diff' },
    { key: 'c', label: '清屏 /clear', action: 'clear' },
    { key: 'q', label: '退出 /exit', action: 'exit' },
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

// ============================================================
// Keyboard input handler (raw mode)
// ============================================================
export interface KeyEvent {
  type: 'char' | 'enter' | 'backspace' | 'up' | 'down' | 'left' | 'right' | 'tab' | 'escape' | 'ctrl_c';
  char?: string;
}

export function setupRawInput(onKey: (ev: KeyEvent) => void, onLine: (line: string) => void): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};

  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  let escSeq = '';
  // Track if last char was \r and next is \n (Windows CRLF)
  let lastWasCR = false;

  const onData = (data: Buffer): void => {
    const str = data.toString();

    // Handle escape sequences (arrows, Shift+Enter, etc.)
    if (str === '\x1b') {
      escSeq = str;
      return;
    }
    if (escSeq) {
      escSeq += str;
      // Up/Down/Left/Right arrows
      if (escSeq === '\x1b[A') { onKey({ type: 'up' }); escSeq = ''; return; }
      if (escSeq === '\x1b[B') { onKey({ type: 'down' }); escSeq = ''; return; }
      if (escSeq === '\x1b[C') { onKey({ type: 'right' }); escSeq = ''; return; }
      if (escSeq === '\x1b[D') { onKey({ type: 'left' }); escSeq = ''; return; }
      // Shift+Enter: \x1b[13;2u or \x1b[13;u
      if (escSeq.match(/^\x1b\[13;/)) { onKey({ type: 'char', char: '\n' }); escSeq = ''; return; }
      // Home/End
      if (escSeq === '\x1b[H' || escSeq === '\x1b[1~') { onKey({ type: 'ctrl_c' }); escSeq = ''; return; } // Map Home to Ctrl+C
      if (escSeq.length > 8) { escSeq = ''; return; }
      return;
    }

    // Windows CRLF: \r\n → treat as single Enter
    if (str === '\r') { lastWasCR = true; onKey({ type: 'enter' }); return; }
    if (str === '\n') {
      if (lastWasCR) { lastWasCR = false; return; } // Ignore LF after CR
      // Standalone \n → Shift+Enter / Ctrl+J → insert newline
      onKey({ type: 'char', char: '\n' });
      return;
    }
    lastWasCR = false;

    // Backspace
    if (str === '\x7f' || str === '\b') {
      onKey({ type: 'backspace' });
      return;
    }

    // Tab
    if (str === '\t') {
      onKey({ type: 'tab' });
      return;
    }

    // Ctrl+C
    if (str === '\x03') {
      onKey({ type: 'ctrl_c' });
      return;
    }

    // Printable character (including Unicode)
    if (str.length >= 1 && str.charCodeAt(0) >= 32) {
      onKey({ type: 'char', char: str });
      return;
    }
  };

  stdin.on('data', onData);

  return () => {
    stdin.removeListener('data', onData);
    if (!wasRaw) stdin.setRawMode(false);
  };
}

// ============================================================
// Multi-line Input Box (S20.5)
// ============================================================
export class InputBox {
  lines: string[] = [''];
  cursorRow = 0;
  cursorCol = 0;
  scrollOffset = 0;
  history: string[] = [];
  historyIdx = -1;
  maxHeight = 6;
  onBeforeSubmit?: () => string; // Returns bottom panel text to print after submit

  get text(): string { return this.lines.join('\n'); }

  insertChar(ch: string): void {
    const line = this.lines[this.cursorRow];
    this.lines[this.cursorRow] = line.substring(0, this.cursorCol) + ch + line.substring(this.cursorCol);
    this.cursorCol++;
  }

  handleBackspace(): void {
    if (this.cursorCol > 0) {
      const line = this.lines[this.cursorRow];
      this.lines[this.cursorRow] = line.substring(0, this.cursorCol - 1) + line.substring(this.cursorCol);
      this.cursorCol--;
    } else if (this.cursorRow > 0) {
      const prevLen = this.lines[this.cursorRow - 1].length;
      this.lines[this.cursorRow - 1] += this.lines[this.cursorRow];
      this.lines.splice(this.cursorRow, 1);
      this.cursorRow--;
      this.cursorCol = prevLen;
    }
  }

  handleEnter(): 'submit' | 'newline' {
    // Detect Shift+Enter via timing — if raw sequence shows Shift modifier
    // Simple approach: always submit on Enter for now
    // Shift+Enter detection done in the raw input handler via character sequences
    return 'submit';
  }

  handleShiftEnter(): void {
    const line = this.lines[this.cursorRow];
    const rest = line.substring(this.cursorCol);
    this.lines[this.cursorRow] = line.substring(0, this.cursorCol);
    this.lines.splice(this.cursorRow + 1, 0, rest);
    this.cursorRow++;
    this.cursorCol = 0;
  }

  handleUp(): void {
    if (this.cursorRow > 0) {
      this.cursorRow--;
      this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
    } else if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.loadFromHistory();
    }
  }

  handleDown(): void {
    if (this.cursorRow < this.lines.length - 1) {
      this.cursorRow++;
      this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
    } else if (this.historyIdx > 0) {
      this.historyIdx--;
      this.loadFromHistory();
    } else if (this.historyIdx === 0) {
      this.historyIdx = -1;
      this.lines = [''];
      this.cursorRow = 0;
      this.cursorCol = 0;
    }
  }

  handleLeft(): void {
    if (this.cursorCol > 0) { this.cursorCol--; }
    else if (this.cursorRow > 0) { this.cursorRow--; this.cursorCol = this.lines[this.cursorRow].length; }
  }

  handleRight(): void {
    if (this.cursorCol < this.lines[this.cursorRow].length) { this.cursorCol++; }
    else if (this.cursorRow < this.lines.length - 1) { this.cursorRow++; this.cursorCol = 0; }
  }

  addToHistory(text: string): void {
    if (text.trim() && this.history[0] !== text) {
      this.history.unshift(text);
      if (this.history.length > 100) this.history.pop();
    }
    this.historyIdx = -1;
  }

  reset(): void {
    this.lines = [''];
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrollOffset = 0;
    this.historyIdx = -1;
  }

  private loadFromHistory(): void {
    const text = this.history[this.historyIdx] || '';
    this.lines = text.split('\n');
    this.cursorRow = this.lines.length - 1;
    this.cursorCol = this.lines[this.cursorRow].length;
  }

  render(tw: number): string {
    const w = tw - 6; // padding inside box
    let out = '';

    // Top border
    out += `  ${C.accent('╭─')} ${C.accent('输入')} ${C.accent('─'.repeat(Math.max(2, w - 6)) + '╮')}\n`;

    // Content area
    const visibleH = Math.min(this.lines.length, this.maxHeight);
    const startRow = Math.max(0, Math.min(this.cursorRow - this.maxHeight + 1, this.lines.length - visibleH));
    this.scrollOffset = startRow;

    if (this.scrollOffset > 0) {
      out += `  ${C.accent('│')} ${C.dim('↑ 还有 ' + this.scrollOffset + ' 行')}${' '.repeat(w - (10 + String(this.scrollOffset).length))}${C.accent('│')}\n`;
    }
    for (let i = startRow; i < Math.min(startRow + visibleH, this.lines.length); i++) {
      const line = this.lines[i];
      const display = line.length > w - 2 ? line.substring(0, w - 5) + '…' : line;
      out += `  ${C.accent('│')} ${display}${' '.repeat(Math.max(0, w - 2 - display.length))}${C.accent('│')}\n`;
    }
    if (startRow + visibleH < this.lines.length) {
      const remaining = this.lines.length - startRow - visibleH;
      out += `  ${C.accent('│')} ${C.dim('↓ 还有 ' + remaining + ' 行')}${' '.repeat(w - (10 + String(remaining).length))}${C.accent('│')}\n`;
    }

    // Bottom border with hints
    out += `  ${C.accent('╰─')} ${C.dim('Enter 发送 | Shift+Enter 换行 | ↑↓ 历史')} ${C.accent('─'.repeat(Math.max(2, w - 35)) + '╯')}`;

    return out;
  }
}

// ============================================================
// Cursor manipulation
// ============================================================
export function moveToInputLine(): void {
  // Cursor already at input line after render
}

export function clearInputLine(): void {
  process.stdout.write('\r\x1b[K');
}

export function writePrompt(): void {
  process.stdout.write(`${C.accent('◇')}  `);
}
