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

export function welcomeScreen(provider: string, model: string, projectName?: string): string {
  const tw = termWidth(); const ow = Math.min(tw - 4, 76);
  const poweredPlain = `  Powered by ${provider} / ${model}`;
  const powered = C.dim('  Powered by ') + C.accent(provider) + C.dim(' / ') + C.primary(model);
  const wm = [
    '', '  ' + C.primary('╭') + C.primary('═'.repeat(ow)) + C.primary('╮'),
    '  ' + C.primary('║') + '  ' + ' '.repeat(ow - 4) + '  ' + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.accentBold('   i C l o s e r') + C.primaryBold('   Agent Shell') + ' '.repeat(Math.max(0, ow - 41)) + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.dim('  Terminal AI Engineering Assistant') + ' '.repeat(Math.max(0, ow - 39)) + C.primary('║'),
    '  ' + C.primary('║') + '  ' + powered + ' '.repeat(Math.max(0, ow - 4 - poweredPlain.length)) + '  ' + C.primary('║'),
    '  ' + C.primary('║') + '  ' + ' '.repeat(ow - 4) + '  ' + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.primary('━'.repeat(ow - 4)) + '  ' + C.primary('║'),
    '  ' + C.primary('║') + '  ' + ' '.repeat(ow - 4) + '  ' + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.bright('  Session') + ' '.repeat(ow - 14) + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.dim('  Provider') + '     ' + C.accent(provider.padEnd(16)) + C.dim('Model') + '  ' + C.primary(model) + ' '.repeat(Math.max(0, ow - 53 - provider.length - model.length)) + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.dim('  Platform') + '     ' + C.bright(process.platform) + '  ' + C.dim('Node') + '   ' + C.bright(process.version) + ' '.repeat(Math.max(0, ow - 56)) + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.dim('  Time') + '         ' + C.bright(new Date().toLocaleString('zh-CN', { hour12: false })) + ' '.repeat(Math.max(0, ow - 36)) + C.primary('║'),
  ];
  if (projectName) wm.push('  ' + C.primary('║') + '  ' + C.dim('  Project') + '      ' + C.accent(projectName) + ' '.repeat(Math.max(0, ow - 22 - projectName.length)) + C.primary('║'));
  wm.push(
    '  ' + C.primary('║') + '  ' + ' '.repeat(ow - 4) + '  ' + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.primary('━'.repeat(ow - 4)) + '  ' + C.primary('║'),
    '  ' + C.primary('║') + '  ' + ' '.repeat(ow - 4) + '  ' + C.primary('║'),
    '  ' + C.primary('║') + '  ' + C.dim('  Chat with AI  |  ') + C.accent('/help') + C.dim(' commands') + '  |  ' + C.accent('/exit') + C.dim(' quit') + '  |  ' + C.accent('Ctrl+C') + C.dim(' interrupt') + ' '.repeat(Math.max(0, ow - 89)) + C.primary('║'),
    '  ' + C.primary('║') + '  ' + ' '.repeat(ow - 4) + '  ' + C.primary('║'),
    '  ' + C.primary('╰') + C.primary('═'.repeat(ow)) + C.primary('╯'),
  );
  return wm.join('\n');
}

export function commandHelp(): string {
  const cmds = [
    ['/help', '查看帮助'], ['/init', '初始化项目'], ['/scan', '扫描项目'],
    ['/verify', '验证项目'], ['/write', '写入待确认文件'], ['/diff', '预览变更'],
    ['/undo', '撤销上次写入'], ['/test', '生成测试'], ['/report', '生成报告'],
    ['/commit', '提交 Git'], ['/status', '查看状态'], ['/doctor', '诊断下一步'], ['/config', '查看配置'],
    ['/apikey', '输入 API Key'], ['/start', '启动项目'],
    ['/stop', '停止项目'], ['/restart', '重启项目'],
    ['/clear', '清空对话'], ['/exit', '退出'],
  ];
  const tw = termWidth(); const w = Math.min(tw - 4, 60);
  let out = '  ' + C.primary('╭') + C.primary('─'.repeat(w)) + C.primary('╮') + '\n';
  out += '  ' + C.primary('│') + ' ' + C.primaryBold('iCloser Agent Shell') + ' ' + C.dim('- 常用命令') + ' '.repeat(Math.max(0, w - 33)) + ' ' + C.primary('│') + '\n';
  out += '  ' + C.primary('│') + ' '.repeat(w + 2) + ' ' + C.primary('│') + '\n';
  for (const [cmd, desc] of cmds) {
    out += '  ' + C.primary('│') + ' ' + C.accent(cmd.padEnd(14)) + ' ' + C.dim(desc) + ' '.repeat(Math.max(0, w - 18 - desc.length)) + ' ' + C.primary('│') + '\n';
  }
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
