// Terminal UI engine — multi-pane layout with keyboard navigation
import chalk from 'chalk';
import { C, I, B, termWidth, thinDivider } from './theme.js';

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

  let inputBuf = '';
  let cursorPos = 0;
  let escSeq = '';

  const onData = (data: Buffer): void => {
    const str = data.toString();

    // Handle escape sequences
    if (str === '\x1b') {
      escSeq = str;
      return;
    }
    if (escSeq) {
      escSeq += str;
      if (escSeq === '\x1b[A') { onKey({ type: 'up' }); escSeq = ''; return; }
      if (escSeq === '\x1b[B') { onKey({ type: 'down' }); escSeq = ''; return; }
      if (escSeq === '\x1b[C') { onKey({ type: 'right' }); escSeq = ''; return; }
      if (escSeq === '\x1b[D') { onKey({ type: 'left' }); escSeq = ''; return; }
      if (escSeq.length > 5) { escSeq = ''; return; } // Unknown escape, discard
      return;
    }

    // Enter
    if (str === '\r' || str === '\n') {
      onKey({ type: 'enter' });
      return;
    }

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

    // Escape
    if (str === '\x1b') {
      onKey({ type: 'escape' });
      return;
    }

    // Printable character
    if (str.length === 1 && str.charCodeAt(0) >= 32) {
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
