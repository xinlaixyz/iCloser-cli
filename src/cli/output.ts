// CLI output formatting with colors and spinners
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { buildToolCapabilitySnapshot } from '../core/tool-registry.js';

// ============================================================
// Status Symbols
// ============================================================
export const ICONS = {
  success: chalk.green('[✓]'),
  fail: chalk.red('[✗]'),
  progress: chalk.yellow('[·]'),
  warn: chalk.yellow('[!]'),
  info: chalk.blue('[i]'),
  bullet: '  ',
  arrow: chalk.blue('→'),
};

// ============================================================
// Output Helpers
// ============================================================
export function success(msg: string): void {
  console.log(`${ICONS.success} ${msg}`);
}

export function fail(msg: string): never {
  process.stdout.write(`${ICONS.fail} ${msg}\n`);
  process.exit(1);
}

export function progress(msg: string): void {
  console.log(`${ICONS.progress} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${ICONS.warn} ${chalk.yellow(msg)}`);
}

export function info(msg: string): void {
  console.log(`${ICONS.info} ${msg}`);
}

export function title(msg: string): void {
  console.log(`\n${chalk.bold.blue(msg)}`);
}

export function section(msg: string): void {
  console.log(`\n${chalk.bold(msg)}`);
}

export function detail(label: string, value: string): void {
  console.log(`${ICONS.bullet}${chalk.dim(label)}: ${value}`);
}

export function list(items: string[], indent = 2): void {
  const prefix = ' '.repeat(indent);
  for (const item of items) {
    console.log(`${prefix}${chalk.dim('—')} ${item}`);
  }
}

export function table(rows: string[][], indent = 2): void {
  if (rows.length === 0) return;
  const colWidths: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i] || 0, stripAnsi(row[i]).length);
    }
  }
  const prefix = ' '.repeat(indent);
  for (const row of rows) {
    const cells = row.map((cell, i) => cell.padEnd(colWidths[i] + 2));
    console.log(prefix + cells.join(''));
  }
}

export function divider(): void {
  console.log(chalk.dim('─'.repeat(60)));
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ============================================================
// Output sanitization (S20.1)
// ============================================================
let sanitizedCount = 0;
let sanitizedLines = 0;
const MAX_LINE_LENGTH = 1000;

export function sanitizeOutput(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Pass ANSI escape sequence: ESC(27) + '[' + ... + letter
    if (code === 27 && i + 1 < text.length && text[i + 1] === '[') {
      out += text[i]; i++;
      out += text[i]; // '['
      // Consume until the terminator letter (A-Z, a-z)
      while (i + 1 < text.length) {
        i++;
        const c = text.charCodeAt(i);
        out += text[i];
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) break;
      }
      continue;
    }
    // Allow: \n(10), \r(13), \t(9), printable(32-126), Unicode(128+), surrogates
    if (code === 10 || code === 13 || code === 9) { out += text[i]; continue; }
    if (code >= 32 && code <= 126) { out += text[i]; continue; }
    if (code >= 128 && code <= 0xD7FF) { out += text[i]; continue; }
    if (code >= 0xE000 && code <= 0xFFFF) { out += text[i]; continue; }
    if (code >= 0xD800 && code <= 0xDFFF) { out += text[i]; continue; }
    sanitizedCount++;
  }
  // Truncate overly long lines
  const lines = out.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_LINE_LENGTH) {
      lines[i] = lines[i].substring(0, MAX_LINE_LENGTH - 3) + '…';
      sanitizedLines++;
      changed = true;
    }
  }
  return changed ? lines.join('\n') : out;
}

export function sanitizeWrite(data: string | Uint8Array, encoding?: BufferEncoding | undefined): boolean {
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const cleaned = sanitizeOutput(str);
  return process.stdout.write(cleaned, encoding as BufferEncoding | undefined);
}

let stdoutPatched = false;
export function enableOutputSanitizer(): void {
  if (stdoutPatched) return;
  const orig = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (data: string | Uint8Array, encoding?: BufferEncoding, cb?: (err?: Error | null) => void): boolean => {
    const cleaned = sanitizeOutput(typeof data === 'string' ? data : new TextDecoder().decode(data));
    return orig(cleaned, encoding, cb);
  };
  stdoutPatched = true;
}

export function getSanitizerStats(): { chars: number; lines: number } {
  return { chars: sanitizedCount, lines: sanitizedLines };
}

// ============================================================
// Spinner
// ============================================================
export function spinner(text: string): Ora {
  return ora({
    text: chalk.cyan(text),
    spinner: 'dots',
    color: 'cyan',
  });
}

// ============================================================
// Specialized Output
// ============================================================
export function printProjectIdentity(identity: {
  language: string;
  framework: string;
  database: string;
  buildSystem: string;
  testFramework: string;
  runtime: string;
  languageVersion: string;
}): void {
  section('项目身份识别');
  detail('语言', identity.language);
  detail('框架', identity.framework || '无');
  detail('数据库', identity.database || '未检测到');
  detail('构建系统', identity.buildSystem || '未检测到');
  detail('测试框架', identity.testFramework || '未检测到');
  detail('运行时', identity.runtime);
  if (identity.languageVersion !== 'unknown') {
    detail('版本', identity.languageVersion);
  }
}

export function printTaskSummary(task: {
  id: string;
  description: string;
  status: string;
  changes: number;
  tests: number;
  riskLevel: string;
}): void {
  const statusIcon = task.status === 'completed' ? ICONS.success :
    task.status === 'failed' ? ICONS.fail :
    task.status === 'running' ? ICONS.progress : ICONS.info;

  console.log(`${statusIcon} ${chalk.bold(task.id.substring(0, 8))}  ${task.description}`);
  if (task.status === 'completed') {
    console.log(`${ICONS.bullet}修改文件: ${task.changes}  测试: ${task.tests}  风险: ${task.riskLevel}`);
  }
}

export function printVerifyResult(result: {
  overall: string;
  stages: { stage: string; status: string }[];
  totalTests: number;
  passedTests: number;
  attempts: number;
  coverage?: { lineCoverage: number; branchCoverage: number; coveredLines: number; totalLines: number };
}): void {
  section('验证结果');
  for (const stage of result.stages) {
    const icon = stage.status === 'pass' ? ICONS.success :
      stage.status === 'fail' ? ICONS.fail : ICONS.warn;
    console.log(`${icon} ${stage.stage}`);
  }
  if (result.totalTests > 0) {
    detail('测试', `${result.passedTests}/${result.totalTests} 通过`);
  }
  if (result.coverage && result.coverage.totalLines > 0) {
    detail('行覆盖率', `${result.coverage.lineCoverage}% (${result.coverage.coveredLines}/${result.coverage.totalLines})`);
    if (result.coverage.branchCoverage > 0) {
      detail('分支覆盖率', `${result.coverage.branchCoverage}%`);
    }
  }
  if (result.attempts > 1) {
    detail('修复轮次', `${result.attempts}`);
  }
}

export function printGateResult(result: {
  passed: boolean;
  checks: { name: string; status: string; detail: string }[];
  blocking: { name: string; detail: string; suggestion?: string }[];
}): void {
  section('门禁检查');
  for (const check of result.checks) {
    const icon = check.status === 'pass' ? ICONS.success :
      check.status === 'fail' ? ICONS.fail :
      check.status === 'warn' ? ICONS.warn : ICONS.progress;
    console.log(`${icon} ${chalk.bold(check.name)}  — ${check.detail}`);
  }

  if (result.passed) {
    console.log(`\n${ICONS.success} ${chalk.green.bold('门禁通过，任务可交付')}`);
  } else {
    console.log(`\n${ICONS.fail} ${chalk.red.bold('门禁阻塞：')}${result.blocking.map(b => b.name).join(', ')}`);
    for (const b of result.blocking) {
      if (b.suggestion) {
        console.log(`  ${chalk.yellow('→ 建议：')}${b.suggestion}`);
      }
    }
  }
}

export function printError(err: Error | string): void {
  if (
    typeof err === 'object' &&
    err !== null &&
    'toDisplay' in err &&
    typeof (err as { toDisplay?: unknown }).toDisplay === 'function'
  ) {
    const display = (err as { toDisplay(): string }).toDisplay();
    console.log(`\n${ICONS.fail} ${chalk.red(display)}`);
    return;
  }
  const message = typeof err === 'string' ? err : err.message;
  console.log(`\n${ICONS.fail} ${chalk.red('错误：')}${message}`);
}

export function printHelp(): void {
  console.log(`
${chalk.bold.blue('ic — iCloser Agent Shell')} ${chalk.dim('AI 工程执行 CLI')}

${chalk.bold('首次使用')}
  ${chalk.cyan('ic setup')}                 配置 AI 服务和环境
  ${chalk.cyan('ic init')}                  初始化项目（自动识别语言/框架/DB）
  ${chalk.cyan('ic doctor')}                检查项目是否就绪

${chalk.bold('核心命令')}
  ${chalk.cyan('ic t "<描述>"')}             创建并执行任务
  ${chalk.cyan('ic t "<描述>" --go')}        直接执行，跳过预览
  ${chalk.cyan('ic st [task-id]')}          查看任务状态
  ${chalk.cyan('ic r')}                     查看最近任务报告
  ${chalk.cyan('ic g <task-id>')}           门禁检查（6 道门禁）
  ${chalk.cyan('ic d <task-id>')}           查看代码 diff

${chalk.bold('项目管理')}
  ${chalk.cyan('ic scan')}                  扫描项目并更新索引
  ${chalk.cyan('ic search <pattern>')}      搜索代码
  ${chalk.cyan('ic intel <symbol>')}        代码智能：查符号定义、调用关系
  ${chalk.cyan('ic autopilot')}             自动分析项目结构/文档/测试缺口
  ${chalk.cyan('ic overview')}              项目健康总览
  ${chalk.cyan('ic loop')}                  查看三步循环状态和工具矩阵

${chalk.bold('任务管理')}
  ${chalk.cyan('ic y <task-id>')}           确认并执行任务
  ${chalk.cyan('ic n <task-id>')}           拒绝任务
  ${chalk.cyan('ic cancel <task-id>')}      取消排队中的任务
  ${chalk.cyan('ic rollback <task-id>')}    回滚任务修改

${chalk.bold('记忆与配置')}
  ${chalk.cyan('ic mem')}                   查看和管理项目记忆
  ${chalk.cyan('ic rule <描述>')}           添加架构约束
  ${chalk.cyan('ic config')}                查看和修改配置
  ${chalk.cyan('ic audit')}                 查看 Agent 审计日志

${chalk.bold('AI 管理')}
  ${chalk.cyan('ic provider')}              管理 AI Provider / 模型 / API Key
  ${chalk.cyan('ic agent')}                 管理 AI Agent（创建/启停/编排）

${chalk.bold('服务管理')}
  ${chalk.cyan('ic start')}                 启动项目 dev server
  ${chalk.cyan('ic stop')}                  停止后台服务

${chalk.dim('输入 ic <命令> --help 查看命令详情')}
`);
}

const TOOL_FALLBACK_MESSAGES: Record<string, string> = {
  'web-search': '网络搜索暂不可用，已使用本地文档和项目记忆',
  'code-intelligence': '代码智能暂不可用，已降级为：搜索 + 编译错误分析',
  'command': '命令执行未完成，系统不会假装验证通过',
};

let degradedNoticesShown = new Set<string>();

export function printToolDegradationNotice(options: { webSearchAvailable?: boolean; codeIntelligenceAvailable?: boolean; commandAvailable?: boolean } = {}): string[] {
  const messages: string[] = [];
  const snapshot = buildToolCapabilitySnapshot(options);
  const degraded = snapshot.capabilities.filter(c => c.status !== 'available');

  for (const tool of degraded) {
    const msg = TOOL_FALLBACK_MESSAGES[tool.id];
    if (msg && !degradedNoticesShown.has(tool.id)) {
      messages.push(msg);
      degradedNoticesShown.add(tool.id);
    }
  }

  for (const msg of messages) {
    console.log(`  ${ICONS.warn} ${chalk.dim(msg)}`);
  }

  return messages;
}

export function resetToolDegradationNotices(): void {
  degradedNoticesShown = new Set();
}
