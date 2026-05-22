// iCloser Agent Shell — Terminal UI Theme & Design System
import chalk from 'chalk';

export const C = {
  primary: chalk.hex('#6366F1'),
  primaryBold: chalk.hex('#818CF8').bold,
  accent: chalk.hex('#A78BFA'),
  accentBold: chalk.hex('#C4B5FD').bold,
  success: chalk.hex('#34D399'),
  successBold: chalk.hex('#34D399').bold,
  warn: chalk.hex('#FBBF24'),
  warnBold: chalk.hex('#FBBF24').bold,
  error: chalk.hex('#F87171'),
  errorBold: chalk.hex('#F87171').bold,
  info: chalk.hex('#60A5FA'),
  infoBold: chalk.hex('#60A5FA').bold,
  dim: chalk.hex('#6B7280'),
  bright: chalk.hex('#F3F4F6'),
  muted: chalk.hex('#9CA3AF'),
};

export const B = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', dot: '●', hollowDot: '○', arrow: '→', bullet: '▪', diamond: '◆' };

export function termWidth(): number { return process.stdout.columns || 80; }
export function thinDivider(): string { return C.dim('─'.repeat(Math.min(termWidth() - 4, 76))); }

export function drawWideBox(content: string, options: { title?: string; color?: (s: string) => string } = {}): string {
  const color = options.color || C.primary;
  const mw = Math.min(termWidth() - 4, 76);
  const lines = content.split('\n');
  const longest = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length), options.title ? options.title.length + 4 : 0);
  const iw = Math.min(longest + 4, mw);
  const bar = color(B.h.repeat(iw));
  const p: string[] = [];
  if (options.title) p.push(color(B.tl) + B.h + ' ' + options.title + ' ' + color(B.h.repeat(Math.max(0, iw - options.title.length - 4))) + color(B.tr));
  else p.push(color(B.tl) + bar + color(B.tr));
  for (const l of lines) p.push(color(B.v) + ' ' + l + ' '.repeat(Math.max(0, iw - 2 - l.replace(/\x1b\[[0-9;]*m/g, '').length)) + ' ' + color(B.v));
  p.push(color(B.bl) + bar + color(B.br));
  return p.join('\n');
}

export function notification(msg: string, type: 'info' | 'warn' | 'error' | 'success' = 'info'): string {
  const icon = type === 'success' ? C.success('✓') : type === 'warn' ? C.warn('⚠') : type === 'error' ? C.error('✗') : C.info('●');
  const color = type === 'success' ? C.success : type === 'warn' ? C.warn : type === 'error' ? C.error : C.info;
  const w = Math.min(termWidth() - 4, msg.length + 8);
  return '  ' + color('╭' + '─'.repeat(w)) + color('╮') + '\n  ' + color('│') + '  ' + icon + ' ' + msg + ' '.repeat(Math.max(0, w - msg.length - 6)) + ' ' + color('│') + '\n  ' + color('╰' + '─'.repeat(w)) + color('╯');
}

export function statusBar(items: { label: string; value: string; color?: 'primary' | 'accent' | 'success' | 'warn' }[]): string {
  const parts = items.map(i => {
    const vc = i.color === 'primary' ? C.primary : i.color === 'accent' ? C.accent : i.color === 'success' ? C.success : i.color === 'warn' ? C.warn : C.dim;
    return C.dim(i.label + ':') + ' ' + vc(i.value);
  });
  return '  ' + parts.join('  ' + C.dim('│') + '  ');
}

export const I = {
  ok: C.success('✓'), err: C.error('✗'), dot: C.primary('●'), hollow: C.primary('○'),
  warn: C.warn('⚠'), arrow: C.accent('→'), bullet: C.primary('▪'), spark: C.accent('◆'),
  running: C.primary('◉'), waiting: C.warn('◌'),
};

const CJK_RX_THEME = /[一-鿿㐀-䶿豈-﫿　-〿＀-￯぀-ヿ가-힯⺀-⿟]/g;
function dw(str: string): number { const c = str.replace(/\x1b\[[0-9;]*m/g, ''); return c.length + (c.match(CJK_RX_THEME) || []).length; }

function padAnsi(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - dw(str)));
}

function fitAnsi(str: string, width: number): string {
  const clean = str.replace(/\x1b\[[0-9;]*m/g, '');
  if (dw(clean) <= width) return str;
  const clipped = clean.slice(0, Math.max(0, width - 1));
  return clipped + '…';
}

function frameLine(innerWidth: number, content = ''): string {
  const fitted = fitAnsi(content, innerWidth);
  return '  ' + C.dim('║') + padAnsi(fitted, innerWidth) + C.dim('║');
}

function kv(label: string, value: string, color: (s: string) => string = C.bright): string {
  return C.dim(label.padEnd(10)) + color(value);
}

function kvPair(
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
  width: number,
  leftColor: (s: string) => string = C.bright,
  rightColor: (s: string) => string = C.bright,
): string {
  const gap = 4;
  const col = Math.floor((width - gap) / 2);
  const left = kv(leftLabel, fitAnsi(leftValue, Math.max(8, col - 11)), leftColor);
  const right = kv(rightLabel, fitAnsi(rightValue, Math.max(8, col - 11)), rightColor);
  return padAnsi(left, col) + ' '.repeat(gap) + right;
}

function normalizeQuickStep(step: string): string {
  return step.replace(/^\s*(?:\d+[\s.)、-]+)+/, '').trim();
}

function _pixelLogoLines(): string[] {
  return [
    "           \u001b[38;2;82;179;241m⣀\u001b[0m\u001b[38;2;220;238;252m⣀\u001b[0m\u001b[38;2;220;238;252m⣤\u001b[0m\u001b[38;2;220;238;252m⣀\u001b[0m\u001b[38;2;220;238;252m⡴\u001b[0m\u001b[38;2;220;238;252m⢶\u001b[0m\u001b[38;2;186;232;255m⣆\u001b[0m\u001b[38;2;186;232;255m⡠\u001b[0m\u001b[38;2;186;232;255m⣤\u001b[0m\u001b[38;2;186;232;255m⣴\u001b[0m\u001b[38;2;186;232;255m⣄\u001b[0m\u001b[38;2;186;232;255m⣄\u001b[0m\u001b[0m",
    "      \u001b[38;2;174;234;249m⢀\u001b[0m\u001b[38;2;220;238;252m⢤\u001b[0m\u001b[38;2;220;238;252m⡴\u001b[0m\u001b[38;2;220;238;252m⢾\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;220;238;252m⠿\u001b[0m\u001b[38;2;186;232;255m⣷\u001b[0m\u001b[38;2;186;232;255m⣴\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;186;232;255m⣾\u001b[0m\u001b[38;2;186;232;255m⡿\u001b[0m\u001b[38;2;186;232;255m⠾\u001b[0m\u001b[38;2;186;232;255m⡾\u001b[0m\u001b[38;2;186;232;255m⢿\u001b[0m\u001b[38;2;186;232;255m⢿\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;186;232;255m⡷\u001b[0m   \u001b[38;2;174;234;249m⣠\u001b[0m\u001b[38;2;82;179;241m⠦\u001b[0m\u001b[38;2;220;238;252m⢿\u001b[0m\u001b[38;2;132;204;243m⡖\u001b[0m\u001b[38;2;174;234;249m⢿\u001b[0m\u001b[38;2;132;204;243m⠛\u001b[0m\u001b[38;2;220;238;252m⡷\u001b[0m\u001b[38;2;162;150;233m⠦\u001b[0m\u001b[38;2;141;96;238m⢄\u001b[0m\u001b[38;2;219;201;248m⡀\u001b[0m\u001b[0m",
    "    \u001b[38;2;174;234;249m⡠\u001b[0m\u001b[38;2;174;234;249m⠢\u001b[0m\u001b[38;2;220;238;252m⣉\u001b[0m\u001b[38;2;186;232;255m⣅\u001b[0m\u001b[38;2;186;232;255m⠍\u001b[0m\u001b[38;2;186;232;255m⣏\u001b[0m\u001b[38;2;186;232;255m⣯\u001b[0m\u001b[38;2;186;232;255m⡿\u001b[0m\u001b[38;2;186;232;255m⢏\u001b[0m\u001b[38;2;186;232;255m⡕\u001b[0m\u001b[38;2;186;232;255m⡶\u001b[0m\u001b[38;2;186;232;255m⡿\u001b[0m\u001b[38;2;186;232;255m⣓\u001b[0m\u001b[38;2;186;232;255m⠖\u001b[0m\u001b[38;2;186;232;255m⠿\u001b[0m\u001b[38;2;220;238;252m⠶\u001b[0m\u001b[38;2;186;232;255m⠾\u001b[0m\u001b[38;2;186;232;255m⠟\u001b[0m\u001b[38;2;186;232;255m⠍\u001b[0m\u001b[38;2;132;204;243m⠐\u001b[0m\u001b[38;2;189;179;241m⠁\u001b[0m \u001b[38;2;132;204;243m⢰\u001b[0m\u001b[38;2;82;179;241m⡟\u001b[0m\u001b[38;2;220;238;252m⠱\u001b[0m\u001b[38;2;58;113;233m⢶\u001b[0m\u001b[38;2;220;238;252m⢝\u001b[0m\u001b[38;2;174;234;249m⡀\u001b[0m\u001b[38;2;220;238;252m⣺\u001b[0m\u001b[38;2;186;232;255m⣳\u001b[0m\u001b[38;2;88;75;213m⡆\u001b[0m\u001b[38;2;186;232;255m⣸\u001b[0m\u001b[38;2;110;107;236m⡇\u001b[0m\u001b[0m",
    "  \u001b[38;2;174;234;249m⠠\u001b[0m\u001b[38;2;186;232;255m⣪\u001b[0m\u001b[38;2;186;232;255m⡄\u001b[0m\u001b[38;2;186;232;255m⢸\u001b[0m\u001b[38;2;186;232;255m⠋\u001b[0m\u001b[38;2;186;232;255m⣶\u001b[0m\u001b[38;2;186;232;255m⡿\u001b[0m\u001b[38;2;186;232;255m⡛\u001b[0m\u001b[38;2;186;232;255m⣵\u001b[0m\u001b[38;2;186;232;255m⢎\u001b[0m\u001b[38;2;186;232;255m⡯\u001b[0m\u001b[38;2;186;232;255m⠋\u001b[0m\u001b[38;2;82;179;241m⠉\u001b[0m           \u001b[38;2;82;179;241m⠑\u001b[0m\u001b[38;2;49;148;234m⢿\u001b[0m\u001b[38;2;82;179;241m⣮\u001b[0m\u001b[38;2;132;204;243m⠜\u001b[0m\u001b[38;2;220;238;252m⢻\u001b[0m\u001b[38;2;132;204;243m⣮\u001b[0m\u001b[38;2;174;234;249m⡿\u001b[0m\u001b[38;2;186;232;255m⣟\u001b[0m\u001b[38;2;186;232;255m⣼\u001b[0m\u001b[38;2;141;96;238m⡾\u001b[0m\u001b[38;2;162;150;233m⠗\u001b[0m\u001b[0m",
    " \u001b[38;2;174;234;249m⠰\u001b[0m\u001b[38;2;186;232;255m⠽\u001b[0m\u001b[38;2;186;232;255m⣲\u001b[0m\u001b[38;2;220;238;252m⡭\u001b[0m\u001b[38;2;186;232;255m⢿\u001b[0m\u001b[38;2;186;232;255m⣘\u001b[0m\u001b[38;2;186;232;255m⢏\u001b[0m\u001b[38;2;186;232;255m⣮\u001b[0m\u001b[38;2;186;232;255m⣞\u001b[0m\u001b[38;2;186;232;255m⢵\u001b[0m\u001b[38;2;162;150;233m⠋\u001b[0m              \u001b[38;2;82;179;241m⠰\u001b[0m\u001b[38;2;58;113;233m⠊\u001b[0m\u001b[38;2;132;204;243m⠛\u001b[0m\u001b[38;2;58;113;233m⠹\u001b[0m\u001b[38;2;110;107;236m⠒\u001b[0m\u001b[38;2;162;150;233m⠥\u001b[0m\u001b[38;2;162;150;233m⠓\u001b[0m\u001b[38;2;162;150;233m⠪\u001b[0m\u001b[38;2;162;150;233m⠋\u001b[0m\u001b[0m",
    " \u001b[38;2;174;234;249m⣿\u001b[0m\u001b[38;2;186;232;255m⡷\u001b[0m\u001b[38;2;186;232;255m⡙\u001b[0m\u001b[38;2;186;232;255m⠾\u001b[0m\u001b[38;2;186;232;255m⡏\u001b[0m\u001b[38;2;186;232;255m⣷\u001b[0m\u001b[38;2;186;232;255m⣾\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;162;150;233m⣬\u001b[0m\u001b[38;2;219;201;248m⡆\u001b[0m\u001b[0m",
    " \u001b[38;2;174;234;249m⠿\u001b[0m\u001b[38;2;186;232;255m⢯\u001b[0m\u001b[38;2;186;232;255m⡉\u001b[0m\u001b[38;2;186;232;255m⡗\u001b[0m\u001b[38;2;186;232;255m⡡\u001b[0m\u001b[38;2;186;232;255m⢃\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;141;96;238m⢦\u001b[0m\u001b[38;2;219;201;248m⡇\u001b[0m\u001b[0m",
    " \u001b[38;2;132;204;243m⡵\u001b[0m\u001b[38;2;186;232;255m⣒\u001b[0m\u001b[38;2;186;232;255m⡧\u001b[0m\u001b[38;2;186;232;255m⢫\u001b[0m\u001b[38;2;186;232;255m⠷\u001b[0m\u001b[38;2;186;232;255m⡽\u001b[0m\u001b[38;2;186;232;255m⠵\u001b[0m\u001b[38;2;186;232;255m⣟\u001b[0m\u001b[38;2;186;232;255m⡯\u001b[0m\u001b[38;2;189;179;241m⢶\u001b[0m\u001b[38;2;132;204;243m⡀\u001b[0m              \u001b[38;2;186;232;255m⣀\u001b[0m\u001b[38;2;186;232;255m⣀\u001b[0m\u001b[38;2;186;232;255m⣀\u001b[0m\u001b[38;2;186;232;255m⡀\u001b[0m \u001b[38;2;105;98;192m⣀\u001b[0m\u001b[0m",
    " \u001b[38;2;82;179;241m⠨\u001b[0m\u001b[38;2;132;204;243m⣭\u001b[0m\u001b[38;2;132;204;243m⣥\u001b[0m\u001b[38;2;186;232;255m⡻\u001b[0m\u001b[38;2;186;232;255m⣕\u001b[0m\u001b[38;2;186;232;255m⡍\u001b[0m\u001b[38;2;186;232;255m⣍\u001b[0m\u001b[38;2;186;232;255m⣺\u001b[0m\u001b[38;2;186;232;255m⡿\u001b[0m\u001b[38;2;186;232;255m⢣\u001b[0m\u001b[38;2;186;232;255m⡾\u001b[0m\u001b[38;2;186;232;255m⣂\u001b[0m\u001b[38;2;49;148;234m⡀\u001b[0m    \u001b[38;2;77;127;205m⢀\u001b[0m\u001b[38;2;186;232;255m⣀\u001b[0m\u001b[38;2;186;232;255m⣠\u001b[0m\u001b[38;2;186;232;255m⣴\u001b[0m\u001b[38;2;49;148;234m⠤\u001b[0m\u001b[38;2;186;232;255m⣯\u001b[0m\u001b[38;2;250;229;156m⣦\u001b[0m\u001b[38;2;250;229;156m⣛\u001b[0m\u001b[38;2;250;229;156m⣫\u001b[0m\u001b[38;2;250;229;156m⣽\u001b[0m\u001b[38;2;250;229;156m⣯\u001b[0m\u001b[38;2;250;229;156m⣺\u001b[0m\u001b[38;2;110;107;236m⣺\u001b[0m\u001b[38;2;110;107;236m⣶\u001b[0m\u001b[38;2;186;232;255m⣺\u001b[0m\u001b[38;2;186;232;255m⠟\u001b[0m\u001b[38;2;186;232;255m⣮\u001b[0m\u001b[38;2;186;232;255m⠶\u001b[0m\u001b[0m",
    "  \u001b[38;2;132;204;243m⠐\u001b[0m\u001b[38;2;162;150;233m⢘\u001b[0m\u001b[38;2;132;204;243m⢿\u001b[0m\u001b[38;2;132;204;243m⢨\u001b[0m\u001b[38;2;186;232;255m⣝\u001b[0m\u001b[38;2;186;232;255m⢦\u001b[0m\u001b[38;2;186;232;255m⢱\u001b[0m\u001b[38;2;186;232;255m⢾\u001b[0m\u001b[38;2;186;232;255m⡭\u001b[0m\u001b[38;2;186;232;255m⢤\u001b[0m\u001b[38;2;186;232;255m⢛\u001b[0m\u001b[38;2;186;232;255m⠯\u001b[0m\u001b[38;2;186;232;255m⢺\u001b[0m\u001b[38;2;186;232;255m⣪\u001b[0m\u001b[38;2;186;232;255m⠽\u001b[0m\u001b[38;2;186;232;255m⠿\u001b[0m\u001b[38;2;186;232;255m⣷\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;186;232;255m⣯\u001b[0m\u001b[38;2;186;232;255m⣷\u001b[0m\u001b[38;2;186;232;255m⡵\u001b[0m\u001b[38;2;250;229;156m⣻\u001b[0m\u001b[38;2;250;229;156m⣿\u001b[0m\u001b[38;2;250;229;156m⣿\u001b[0m\u001b[38;2;250;229;156m⣿\u001b[0m\u001b[38;2;250;229;156m⣿\u001b[0m\u001b[38;2;250;229;156m⡿\u001b[0m\u001b[38;2;250;229;156m⡯\u001b[0m\u001b[38;2;220;238;252m⠗\u001b[0m\u001b[38;2;186;232;255m⣏\u001b[0m\u001b[38;2;220;238;252m⣒\u001b[0m\u001b[38;2;186;232;255m⠊\u001b[0m\u001b[38;2;141;96;238m⠃\u001b[0m\u001b[0m",
    "     \u001b[38;2;189;179;241m⢟\u001b[0m\u001b[38;2;162;150;233m⣟\u001b[0m\u001b[38;2;141;96;238m⣞\u001b[0m\u001b[38;2;186;232;255m⣾\u001b[0m\u001b[38;2;186;232;255m⣞\u001b[0m\u001b[38;2;186;232;255m⡂\u001b[0m\u001b[38;2;186;232;255m⢭\u001b[0m\u001b[38;2;186;232;255m⠯\u001b[0m\u001b[38;2;186;232;255m⣯\u001b[0m\u001b[38;2;186;232;255m⣓\u001b[0m\u001b[38;2;186;232;255m⡹\u001b[0m\u001b[38;2;186;232;255m⢭\u001b[0m\u001b[38;2;186;232;255m⡟\u001b[0m\u001b[38;2;186;232;255m⡋\u001b[0m\u001b[38;2;186;232;255m⠕\u001b[0m\u001b[38;2;186;232;255m⡻\u001b[0m\u001b[38;2;186;232;255m⢿\u001b[0m\u001b[38;2;186;232;255m⣿\u001b[0m\u001b[38;2;186;232;255m⡿\u001b[0m\u001b[38;2;186;232;255m⣪\u001b[0m\u001b[38;2;250;229;156m⣻\u001b[0m\u001b[38;2;250;229;156m⣿\u001b[0m\u001b[38;2;186;232;255m⢿\u001b[0m\u001b[38;2;186;232;255m⢷\u001b[0m\u001b[38;2;186;232;255m⢹\u001b[0m\u001b[38;2;220;238;252m⡕\u001b[0m\u001b[38;2;174;234;249m⣟\u001b[0m\u001b[38;2;174;234;249m⠟\u001b[0m\u001b[38;2;48;67;233m⠃\u001b[0m\u001b[0m",
    "      \u001b[38;2;189;179;241m⠉\u001b[0m\u001b[38;2;162;150;233m⠛\u001b[0m\u001b[38;2;110;107;236m⠿\u001b[0m\u001b[38;2;110;107;236m⣿\u001b[0m\u001b[38;2;94;85;237m⣷\u001b[0m\u001b[38;2;94;85;237m⣶\u001b[0m\u001b[38;2;186;232;255m⣴\u001b[0m\u001b[38;2;186;232;255m⣶\u001b[0m\u001b[38;2;220;238;252m⣆\u001b[0m\u001b[38;2;186;232;255m⣙\u001b[0m\u001b[38;2;186;232;255m⣻\u001b[0m\u001b[38;2;186;232;255m⣯\u001b[0m\u001b[38;2;186;232;255m⢮\u001b[0m\u001b[38;2;186;232;255m⣷\u001b[0m\u001b[38;2;186;232;255m⣢\u001b[0m\u001b[38;2;186;232;255m⠽\u001b[0m\u001b[38;2;220;238;252m⢃\u001b[0m\u001b[38;2;186;232;255m⣴\u001b[0m\u001b[38;2;186;232;255m⠯\u001b[0m\u001b[38;2;186;232;255m⣸\u001b[0m\u001b[38;2;186;232;255m⣟\u001b[0m\u001b[38;2;220;238;252m⣼\u001b[0m\u001b[38;2;174;234;249m⠼\u001b[0m\u001b[38;2;19;91;241m⠞\u001b[0m\u001b[38;2;19;91;241m⠁\u001b[0m\u001b[0m",
    "          \u001b[38;2;94;85;237m⠈\u001b[0m\u001b[38;2;48;67;233m⠉\u001b[0m\u001b[38;2;58;113;233m⠛\u001b[0m\u001b[38;2;19;91;241m⠙\u001b[0m\u001b[38;2;19;91;241m⠛\u001b[0m\u001b[38;2;82;179;241m⠻\u001b[0m\u001b[38;2;82;179;241m⠟\u001b[0m\u001b[38;2;49;148;234m⠾\u001b[0m\u001b[38;2;49;148;234m⠾\u001b[0m\u001b[38;2;19;91;241m⠛\u001b[0m\u001b[38;2;174;234;249m⠻\u001b[0m\u001b[38;2;174;234;249m⠏\u001b[0m\u001b[38;2;49;148;234m⠙\u001b[0m\u001b[38;2;49;148;234m⠛\u001b[0m\u001b[38;2;19;91;241m⠉\u001b[0m\u001b[38;2;19;91;241m⠉\u001b[0m\u001b[38;2;49;148;234m⠉\u001b[0m\u001b[0m",
  ];
}

function _clearLogoLines(): string[] {
  const edge = chalk.hex('#B7F3FF');
  const wire = chalk.hex('#58A6FF');
  const deep = chalk.hex('#3B5BDB');
  const lock = chalk.hex('#A78BFA');
  const card = chalk.hex('#F6D365');
  const dim = C.dim;
  const pad = (line: string) => padAnsi(line, 37);

  return [
    pad('       ' + edge('╭─────────────╮') + '    ' + lock('╭────╮')),
    pad('    ' + edge('╭──╯') + '  ' + wire('●────●') + '     ' + edge('╰╮') + '  ' + lock('│╭──╮│')),
    pad('  ' + edge('╭─╯') + '  ' + dim('╭───────╮') + '      ' + edge('│') + '  ' + lock('││▣ ││')),
    pad(' ' + edge('╭╯') + '   ' + dim('╭╯       ╰╮') + '     ' + edge('│') + '  ' + lock('│╰──╯│')),
    pad(' ' + edge('│') + '    ' + dim('│') + '          ' + edge('╰────╯') + '  ' + lock('╰────╯')),
    pad(' ' + edge('│') + '    ' + dim('│') + '     ' + wire('╭──●──╮')),
    pad(' ' + deep('│') + '    ' + dim('│') + '     ' + wire('│') + '     ' + wire('●')),
    pad(' ' + deep('╰╮') + '   ' + dim('╰╮') + '    ' + wire('╰─────╮') + '  ' + card('╭──╮')),
    pad('  ' + deep('╰╮') + '   ' + dim('╰──') + wire('●') + dim('──╯') + '     ' + card('│▣▣│')),
    pad('    ' + deep('╰╮') + '              ' + card('╰──╯')),
    pad('      ' + deep('╰────────╮') + '      ' + dim('╭─╯')),
    pad('               ' + deep('╰──────╯')),
    pad(''),
  ];
}

export function welcomeScreen(provider: string, model: string, projectName?: string, onboardingSteps?: string[]): string {
  const tw = termWidth();
  const outerWidth = Math.max(72, Math.min(tw - 4, 96));
  const innerWidth = outerWidth - 2;
  const compact = outerWidth < 86;
  const workspace = process.cwd();
  const stack = projectName ? 'Auto detected' : 'Run /scan';
  const rows: string[] = [
    '',
    '  ' + C.dim('╔' + '═'.repeat(outerWidth - 2) + '╗'),
    frameLine(innerWidth),
  ];

  const title = '   ' + C.accentBold('i C l o s e r') + C.bright('   ') + C.primaryBold('Agent Shell');
  if (compact) {
    rows.push(frameLine(innerWidth, title));
    rows.push(frameLine(innerWidth, '   ' + C.bright('Terminal AI Engineering Assistant')));
    rows.push(frameLine(innerWidth));
    rows.push(frameLine(innerWidth, '   ' + kv('PROJECT', projectName || 'Uninitialized', C.accent)));
    rows.push(frameLine(innerWidth, '   ' + kv('PROVIDER', `${provider} / ${model}`, C.primary)));
    rows.push(frameLine(innerWidth, '   ' + kv('WORKSPACE', workspace, C.bright)));
    rows.push(frameLine(innerWidth, '   ' + kv('CONTEXT', 'ready', C.success)));
  } else {
    const contentWidth = innerWidth - 6;
    rows.push(frameLine(innerWidth, title));
    rows.push(frameLine(innerWidth, '   ' + C.bright('Terminal AI Engineering Assistant')));
    rows.push(frameLine(innerWidth));
    rows.push(frameLine(innerWidth, '   ' + kvPair('PROJECT', projectName || 'Uninitialized', 'PROVIDER', `${provider} / ${model}`, contentWidth, C.accent, C.primary)));
    rows.push(frameLine(innerWidth, '   ' + kvPair('WORKSPACE', workspace, 'MEMORY', 'auto recall · project rules', contentWidth, C.bright, C.success)));
    rows.push(frameLine(innerWidth, '   ' + kvPair('STACK', stack, 'CONTEXT', 'live budget · compressed history', contentWidth, C.bright, C.success)));
    rows.push(frameLine(innerWidth));
    rows.push(frameLine(innerWidth, '   ' + kv('FLOW', 'ask → plan → tools → diff → verify', C.dim)));
    rows.push(frameLine(innerWidth, '   ' + kv('EVIDENCE', 'tool calls visible in real time', C.dim)));
    rows.push(frameLine(innerWidth, '   ' + kv('CONTROL', 'review before write / commit', C.dim)));
  }

  rows.push(frameLine(innerWidth));
  rows.push(frameLine(innerWidth, '   ' + C.bright('Ready: ') + C.dim('scan · edit · test · launch · explain')));
  if (onboardingSteps && onboardingSteps.length > 0) {
    rows.push(frameLine(innerWidth));
    const quick = onboardingSteps.slice(0, 3).map((step, idx) => {
      const prefix = idx === 0 ? '   Quick start ' : '               ';
      return prefix + C.dim(String(idx + 1).padStart(2) + '  ') + fitAnsi(normalizeQuickStep(step), innerWidth - dw(prefix) - 7);
    });
    for (const line of quick) rows.push(frameLine(innerWidth, line));
  }
  rows.push(
    frameLine(innerWidth),
    '  ' + C.dim('╚' + '═'.repeat(outerWidth - 2) + '╝'),
  );
  return rows.join('\n');
}

export function commandHelp(): string {
  const groups = [
    ['setup', '配置模型和环境', '/help /apikey /config /doctor /status /exit'],
    ['project', '理解和启动项目', '/scan /context /start /stop'],
    ['ai', '自然语言工程任务', '直接输入需求 /run /orchestrate'],
    ['tools', '搜索、网页、命令证据', '/search /intel /diff'],
    ['code', '代码交付和验证', '/write /diff /verify /undo'],
    ['memory', '长期记忆和项目规则', '/memory /global'],
    ['collab', '提交和团队协作', '/commit /report'],
    ['release', '发布前质量信任', '/verify /report /doctor'],
  ];
  const tw = termWidth(); const w = Math.min(tw - 4, 78);
  let out = '  ' + C.primary('╭') + C.primary('─'.repeat(w)) + C.primary('╮') + '\n';
  out += '  ' + C.primary('│') + ' ' + C.primaryBold('iCloser Agent Shell') + ' ' + C.dim('- 按目标选择，不用背命令') + ' '.repeat(Math.max(0, w - 41)) + ' ' + C.primary('│') + '\n';
  out += '  ' + C.primary('│') + ' '.repeat(w + 2) + ' ' + C.primary('│') + '\n';
  for (const [group, desc, cmds] of groups) {
    const line = `${C.accent(group.padEnd(9))} ${C.bright(desc.padEnd(16))} ${C.dim(cmds)}`;
    const clean = `${group.padEnd(9)} ${desc.padEnd(16)} ${cmds}`;
    out += '  ' + C.primary('│') + ' ' + line + ' '.repeat(Math.max(0, w - clean.length)) + ' ' + C.primary('│') + '\n';
  }
  out += '  ' + C.primary('│') + ' '.repeat(w + 2) + ' ' + C.primary('│') + '\n';
  out += '  ' + C.primary('│') + ' ' + C.dim('新手路径: 直接输入需求 → 看任务驾驶舱 → 看工具证据 → /diff → /write → /verify') + ' '.repeat(Math.max(0, w - 68)) + ' ' + C.primary('│') + '\n';
  out += '  ' + C.primary('│') + ' ' + C.dim('快捷键: y=确认 n=拒绝 h=帮助 s=扫描 d=差异 c=清除 w=写入 q=退出') + ' '.repeat(Math.max(0, w - 42)) + ' ' + C.primary('│') + '\n';
  out += '  ' + C.primary('╰') + C.primary('─'.repeat(w)) + C.primary('╯');
  return out;
}

export function processStep(step: number, total: number, label: string, status: 'pending' | 'running' | 'done' | 'fail' = 'pending'): string {
  const icon = status === 'done' ? I.ok : status === 'fail' ? I.err : status === 'running' ? I.running : I.hollow;
  const c = status === 'done' ? C.success : status === 'fail' ? C.error : status === 'running' ? C.bright : C.dim;
  return '  ' + icon + ' ' + C.dim('[' + step + '/' + total + ']') + ' ' + c(label);
}

export function agentCard(agent: { id: string; type: string; status: string; desc?: string; elapsed?: number; tokens?: number }): string {
  const si = agent.status === 'running' ? I.running : agent.status === 'done' ? I.ok : agent.status === 'failed' ? I.err : I.hollow;
  const sc = agent.status === 'running' ? C.primary : agent.status === 'done' ? C.success : agent.status === 'failed' ? C.error : C.dim;
  const lns: string[] = [];
  lns.push(si + ' Agent ' + C.accent(agent.id.substring(0, 12)) + ' ' + C.dim('[' + agent.type + ']') + ' ' + sc(agent.status));
  if (agent.desc) lns.push('  ' + C.dim('Task:') + ' ' + agent.desc);
  if (agent.elapsed !== undefined) lns.push('  ' + C.dim('Time:') + ' ' + (agent.elapsed / 1000).toFixed(1) + 's');
  if (agent.tokens !== undefined) lns.push('  ' + C.dim('Tokens:') + ' ' + agent.tokens.toLocaleString());
  return drawWideBox(lns.join('\n'));
}
