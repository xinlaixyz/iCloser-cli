// Tool Executor — bridges AI tool calls to local capabilities
import { readFile, fileExists } from '../utils/fs.js';
import { searchWeb, isWebSearchAvailable, getWebSearchStatus } from './web-search.js';
import type { ToolDefinition } from '../ai/provider.js';
import { buildToolCapabilitySnapshot } from './tool-registry.js';

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: string;
  error?: string;
}

// Tool usage metrics
const toolStats = new Map<string, { success: number; failure: number; lastUsed: number }>();
function recordToolUse(name: string, success: boolean): void {
  const s = toolStats.get(name) || { success: 0, failure: 0, lastUsed: 0 };
  if (success) s.success++; else s.failure++;
  s.lastUsed = Date.now();
  toolStats.set(name, s);
}

// ── P0-vis: Tool execution event system ──────────────────────────────────────

export interface ToolExecutionEvent {
  /** 'start' fires before execution; 'end' fires after */
  phase: 'start' | 'end';
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  /** Only present on 'end' events */
  durationMs?: number;
  success?: boolean;
  resultSnippet?: string;
}

type ToolListener = (event: ToolExecutionEvent) => void;
const toolListeners: ToolListener[] = [];

/** Subscribe to tool execution lifecycle events (all call sites, globally). */
export function onToolExecution(listener: ToolListener): void {
  toolListeners.push(listener);
}

/** Unsubscribe from tool execution events. */
export function offToolExecution(listener: ToolListener): void {
  const i = toolListeners.indexOf(listener);
  if (i !== -1) toolListeners.splice(i, 1);
}

function emitToolEvent(event: ToolExecutionEvent): void {
  for (const l of toolListeners) {
    try { l(event); } catch { /* listener errors must not crash the calling tool */ }
  }
}

function toolArgSummary(toolName: string, args: Record<string, unknown>): string {
  void toolName;
  if (args.path) return `· ${String(args.path).slice(0, 60)}`;
  if (args.url) return `· ${String(args.url).slice(0, 60)}`;
  if (args.query) return `· "${String(args.query).slice(0, 50)}"`;
  if (args.pattern) return `· /${String(args.pattern).slice(0, 40)}/`;
  if (args.command) return `· ${String(args.command).slice(0, 50)}`;
  if (args.file) return `· ${String(args.file).slice(0, 60)}`;
  return '';
}

/**
 * Format a tool-start event as a single CLI progress line.
 * Example: "  → read_file · src/utils/fs.ts"
 */
export function formatToolStart(event: ToolExecutionEvent): string {
  return `  → ${event.toolName}${toolArgSummary(event.toolName, event.args)}`;
}

/**
 * Format a tool-end event as a completion line.
 * Example: "  ✓ read_file 142ms — 1234chars"
 */
export function formatToolEnd(event: ToolExecutionEvent): string {
  const icon = event.success !== false ? '✓' : '✗';
  const dur = event.durationMs != null ? ` ${event.durationMs}ms` : '';
  const snip = event.resultSnippet ? ` — ${event.resultSnippet}` : '';
  return `  ${icon} ${event.toolName}${dur}${snip}`;
}

// ── P2: Tool result source citation ──────────────────────────────────────────

/**
 * Builds a compact citation tag to append to tool results so the LLM and humans
 * can trace which tool + source produced a piece of information.
 *
 * Format: [来源: <tool> · <source> · <N>chars]
 */
export function buildToolCitation(toolName: string, args: Record<string, unknown>, resultLen: number): string {
  const source = ((): string => {
    if (args.path) return String(args.path);
    if (args.url) return String(args.url).slice(0, 80);
    if (args.query) return `"${String(args.query).slice(0, 50)}"`;
    if (args.pattern) return `/${String(args.pattern).slice(0, 40)}/`;
    if (args.file) return String(args.file);
    if (args.command) return `\`${String(args.command).slice(0, 50)}\``;
    if (args.action) return String(args.action);
    return '';
  })();
  const parts = [toolName, source, `${resultLen}chars`].filter(Boolean);
  return `\n[来源: ${parts.join(' · ')}]`;
}

/** Tools whose results carry a source citation (knowledge-producing reads). */
const CITE_TOOLS = new Set([
  'read_file', 'read_docx', 'read_xlsx', 'read_pdf',
  'search_code', 'web_fetch', 'web_search', 'code_intel',
]);

// ── P1-3: Adaptive retry tracking ──
interface ToolAttempt {
  tool: string;
  args: Record<string, unknown>;
  resultSummary: string;  // "found 5 matches" | "empty" | "error"
  timestamp: number;
}
const toolAttemptsPerTask = new Map<string, ToolAttempt[]>();

export function recordToolAttempt(taskId: string, tool: string, args: Record<string, unknown>, resultSummary: string): void {
  if (!toolAttemptsPerTask.has(taskId)) toolAttemptsPerTask.set(taskId, []);
  const history = toolAttemptsPerTask.get(taskId)!;
  history.push({ tool, args, resultSummary, timestamp: Date.now() });
  // Keep only last 20 attempts per task
  if (history.length > 20) history.splice(0, history.length - 20);
}

export function getAdaptiveStrategyHint(taskId: string): string {
  const history = toolAttemptsPerTask.get(taskId);
  if (!history || history.length < 3) return '';

  const recent = history.slice(-3);
  const allEmpty = recent.every(a => a.resultSummary.includes('empty') || a.resultSummary.includes('未找到') || a.resultSummary.includes('0 条'));
  const sameTool = new Set(recent.map(a => a.tool)).size === 1;

  if (allEmpty && sameTool) {
    const toolName = recent[0].tool;
    const hints: Record<string, string> = {
      search_code: `[策略提示] 最近 3 次 ${toolName} 均未找到结果。建议: (1) 更换搜索关键词 (2) 改用 read_file 直接查看文件 (3) 用 code_intel 查询符号。`,
      read_file: `[策略提示] 最近 3 次 ${toolName} 读取失败。建议检查文件路径是否正确，或用 search_code 定位文件。`,
      run_command: `[策略提示] 最近 3 次 ${toolName} 执行失败。建议改用 read_file 或 search_code 代替命令。`,
    };
    return hints[toolName] || `[策略提示] 最近 3 次 ${toolName} 均未成功。建议切换工具重试。`;
  }
  return '';
}

export function clearToolAttempts(taskId: string): void {
  toolAttemptsPerTask.delete(taskId);
}

// ── P1-2: Shared result compression ──

function compressFileContent(lines: string[], totalLines: number): string {
  if (totalLines <= 200) return lines.join('\n');
  const keyLines = lines.filter((l, i) =>
    i < 30 || i > totalLines - 10 ||
    /^(import|export|function|class|interface|type|const|let|var|public|private|#|##|\/\/|func |def |package )/.test(l)
  );
  return keyLines.slice(0, 100).join('\n') + `\n... (${totalLines} 行，已压缩为关键行)`;
}

function compressSearchResults(results: string[], maxFull: number, tailKeep: number): string {
  if (results.length <= maxFull) {
    return `找到 ${results.length} 条匹配:\n${results.join('\n')}`;
  }
  const head = results.slice(0, maxFull);
  const tail = results.slice(-tailKeep);
  const header = `找到 ${results.length} 条匹配 (显示前 ${maxFull} + 后 ${tailKeep}):\n`;
  return header + head.join('\n') + `\n... 省略 ${results.length - maxFull - tailKeep} 条 ...\n` + tail.join('\n') +
    '\n(结果过多，请缩小搜索范围或用更精确的关键词)';
}

function compressCommandOutput(output: string): string {
  const lines = output.split('\n');
  const maxLines = 300;
  if (lines.length <= maxLines) {
    return output.length > 2000 ? output.slice(0, 2000) + '\n... (输出已截断至 2000 字符)' : output;
  }
  const head = lines.slice(0, 50);
  const tail = lines.slice(-20);
  return head.join('\n') + `\n... 省略 ${lines.length - 70} 行 ...\n` + tail.join('\n') +
    `\n(输出共 ${lines.length} 行，已压缩为关键行)`;
}

// ── P1-4: Platform-aware command auto-conversion ──

const WIN_CMD_MAP: Record<string, string> = {
  ls: 'dir', grep: 'findstr /n', cat: 'type',
  tail: 'powershell -Command "Get-Content -Tail', head: 'powershell -Command "Get-Content -Head',
  which: 'where', wget: 'curl -o', cp: 'copy', mv: 'move',
  mkdir: 'mkdir', rm: 'del /q', chmod: 'attrib', diff: 'fc',
  wc: 'powershell -Command "(Get-Content %f | Measure-Object -Line).Lines"',
  sort: 'sort', uniq: 'powershell -Command "Get-Unique"', tar: 'tar',
  env: 'set', kill: 'taskkill /f /im', ps: 'tasklist',
  awk: 'powershell -Command', sed: 'powershell -Command',
  xargs: 'powershell -Command "ForEach-Object"', uname: 'ver',
  touch: 'type nul >', clear: 'cls', pwd: 'cd', whoami: 'whoami',
  hostname: 'hostname', date: 'date /t', sleep: 'timeout /t',
  // Multi-language build tools
  mvnw: 'mvnw.cmd', gradlew: 'gradlew.bat',
  python3: 'python', pip3: 'pip',
};

const WIN_CMD_REWRITE: Record<string, (args: string[]) => string> = {
  tail: (args) => `powershell -Command "Get-Content -Tail ${args[0] || '10'} ${args.slice(1).join(' ')}"`,
  head: (args) => `powershell -Command "Get-Content -Head ${args[0] || '10'} ${args.slice(1).join(' ')}"`,
  find: (args) => `dir /s /b ${args.join(' ')} 2>nul`,
  grep: (args) => `findstr /n /i ${args.join(' ')}`,
  tar: (args) => `tar ${args.join(' ')}`,
};

// Gate-3: Tool-strategy validator — verify tool calls match intent strategy
export async function validateToolCallForIntent(
  toolName: string,
  intentCategory: string,
): Promise<{ valid: boolean; suggestion?: string }> {
  // Lazy-load strategy module to avoid circular deps
  const { getStrategyForIntent } = await import('./tool-strategy.js');
  const strategy = getStrategyForIntent(intentCategory as any);
  if (!strategy || strategy.steps.length === 0) return { valid: true }; // no strategy = no validation

  const toolInStrategy = strategy.steps.some((s: any) => s.tool === toolName);
  if (!toolInStrategy) {
    const expectedTools = strategy.steps.map((s: any) => s.tool).join(', ');
    return {
      valid: false,
      suggestion: `工具 "${toolName}" 不在意图 "${intentCategory}" 的推荐策略中。推荐: ${expectedTools}`,
    };
  }
  return { valid: true };
}

function isWindows(): boolean { return process.platform === 'win32'; }

// Complete dangerous-command detection (deny-list for run_command tool)
function isDangerousCmd(cmd: string): boolean {
  const patterns = [
    // Unix destructive
    /\brm\s+.*-(?:[rR]\S*[fF]|[fF]\S*[rR])\b/,  // rm with both -r and -f
    /\brmdir\s+\/s\b/i,                               // Unix recursive rmdir
    /\bsudo\b/i,                                      // privilege escalation
    /\bchmod\s+777\b/i,                               // overbroad permissions
    /\bmkfs\b/i,                                      // make filesystem
    /\bdd\s+if=/i,                                    // raw disk write
    /\bmv\s+\/[^\s]*\s+\/(dev|etc|sys|proc|bin|boot|lib)\b/i,  // move to system dirs
    />\s*\/dev\//i,                                   // redirect to device
    /\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,    // fork bomb
    // Windows destructive
    /\brd\s+\/s\b/i,                                  // Windows recursive rmdir
    /\bformat\s+[a-z]:/i,                             // format drive
    /\bdiskpart\b/i,                                  // disk partition tool
    /\bdel\s+\/[fF]\b/,                               // Windows force delete
    /\bdel\s+\/[sS]\b/,                               // Windows recursive delete
    /\breg\s+delete\b/i,                              // registry deletion
    /\breg\s+add\b/i,                                 // registry modification
    /\bsc\s+(stop|delete|config)\b/i,                 // service manipulation
    /\bbcdedit\b/i,                                   // boot configuration
    /\bwmic\s+(process|path)\s+(call\s+create|delete)\b/i,  // WMI process creation
    /\btaskkill\s+\/F\b/i,                            // force kill processes
  ];
  return patterns.some(p => p.test(cmd));
}

async function autoAdaptCommand(command: string, rootPath: string): Promise<{ adapted: string; wasAdapted: boolean }> {
  if (!isWindows()) return { adapted: command, wasAdapted: false };

  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/\.exe$/, '');
  const args = parts.slice(1);

  // Check for windows-native commands (no adaptation needed)
  const windowsNative = /^(dir|type|findstr|copy|move|del|fc|set|tasklist|taskkill|ver|cls|whoami|hostname|date|timeout|node|npm|npx(\.cmd)?|tsx|tsc|vitest|jest|pnpm|yarn|cargo|dotnet|msbuild)\b/i;
  if (windowsNative.test(cmd)) return { adapted: command, wasAdapted: false };

  // Check for mvnw/gradlew — prefer local wrappers
  if (cmd === 'mvn' || cmd === 'mvnw') {
    const mvnwPath = [rootPath, 'mvnw.cmd'].join('/').replace(/\/+/g, '/');
    const mvnwAlt = [rootPath, 'mvnw'].join('/').replace(/\/+/g, '/');
    if (await fileExists(mvnwPath)) return { adapted: 'mvnw.cmd ' + args.join(' '), wasAdapted: true };
    if (await fileExists(mvnwAlt)) return { adapted: 'mvnw ' + args.join(' '), wasAdapted: true };
    return { adapted: 'mvn ' + args.join(' '), wasAdapted: false };
  }
  if (cmd === 'gradle' || cmd === 'gradlew') {
    const gradlewPath = [rootPath, 'gradlew.bat'].join('/').replace(/\/+/g, '/');
    const gradlewAlt = [rootPath, 'gradlew'].join('/').replace(/\/+/g, '/');
    if (await fileExists(gradlewPath)) return { adapted: 'gradlew.bat ' + args.join(' '), wasAdapted: true };
    if (await fileExists(gradlewAlt)) return { adapted: 'gradlew ' + args.join(' '), wasAdapted: true };
    return { adapted: 'gradle ' + args.join(' '), wasAdapted: false };
  }

  // Rewrite rules for commands with complex argument remapping
  if (WIN_CMD_REWRITE[cmd]) {
    return { adapted: WIN_CMD_REWRITE[cmd](args), wasAdapted: true };
  }

  // Simple 1:1 mapping
  if (WIN_CMD_MAP[cmd]) {
    return { adapted: WIN_CMD_MAP[cmd] + ' ' + args.join(' '), wasAdapted: true };
  }

  // Go/Python/Cargo: add .cmd/.exe if on Windows for known toolchains
  if (/^(go|python3?|pip3?|rustc|rustup)$/i.test(cmd)) {
    return { adapted: command, wasAdapted: false }; // these work via PATH on Windows too
  }

  return { adapted: command, wasAdapted: false };
}

export function getToolStats(): Record<string, { success: number; failure: number; lastUsed: number }> {
  return Object.fromEntries(toolStats);
}

// Tool health diagnostic
export function getToolHealth(): { name: string; status: 'available' | 'limited' | 'unavailable'; reason: string }[] {
  const snapshot = buildToolCapabilitySnapshot();
  return snapshot.capabilities.map(c => ({
    name: c.name,
    status: c.status as 'available' | 'limited' | 'unavailable',
    reason: c.status === 'available' ? '正常' : c.status === 'limited' ? c.reason : c.fallback,
  }));
}

// ── P1: Tool permission matrix & sandbox documentation ───────────────────────

export interface ToolPermission {
  name: string;
  displayName: string;
  canReadFiles: boolean;
  canWriteFiles: boolean;
  canRunCommands: boolean;
  canAccessNetwork: boolean;
  requiresConfirmation: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  sandboxNote: string;
}

const TOOL_PERMISSIONS: Record<string, ToolPermission> = {
  read_file: {
    name: 'read_file', displayName: '文件读取',
    canReadFiles: true, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '只读访问项目文件；不能写入、执行或访问网络。',
  },
  read_docx: {
    name: 'read_docx', displayName: 'Word 文档读取',
    canReadFiles: true, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '只读解析 .docx 格式；ZIP 解压在内存中进行，不执行宏。',
  },
  read_xlsx: {
    name: 'read_xlsx', displayName: 'Excel 表格读取',
    canReadFiles: true, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '只读解析 .xlsx 格式；仅提取单元格文本，不执行公式或宏。',
  },
  read_pdf: {
    name: 'read_pdf', displayName: 'PDF 读取',
    canReadFiles: true, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '只读解析 PDF；如需第三方库（pdf-parse），须 npm install。',
  },
  search_code: {
    name: 'search_code', displayName: '代码搜索',
    canReadFiles: true, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '在项目文件内执行正则搜索，只读，无网络访问。',
  },
  run_command: {
    name: 'run_command', displayName: '命令执行',
    canReadFiles: true, canWriteFiles: true, canRunCommands: true, canAccessNetwork: true,
    requiresConfirmation: true, riskLevel: 'high',
    sandboxNote: '在项目目录下运行本地命令；危险命令（rm -rf 等）被 deny-list 拦截；高风险操作需用户确认。',
  },
  web_search: {
    name: 'web_search', displayName: '网络搜索',
    canReadFiles: false, canWriteFiles: false, canRunCommands: false, canAccessNetwork: true,
    requiresConfirmation: false, riskLevel: 'medium',
    sandboxNote: '通过 DuckDuckGo API 发起只读搜索请求；不发送任何本地文件内容。',
  },
  web_fetch: {
    name: 'web_fetch', displayName: '网页抓取',
    canReadFiles: false, canWriteFiles: false, canRunCommands: false, canAccessNetwork: true,
    requiresConfirmation: false, riskLevel: 'medium',
    sandboxNote: '抓取指定 URL 的公开内容；本地文件与项目代码不会被上传。',
  },
  code_intel: {
    name: 'code_intel', displayName: '代码智能',
    canReadFiles: true, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '静态 AST 解析；只读，无网络，不执行代码。',
  },
  git_status: {
    name: 'git_status', displayName: 'Git 状态',
    canReadFiles: false, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '只允许只读 git 子命令（status/log/diff/branch）；不能提交、推送或修改仓库。',
  },
  list_dir: {
    name: 'list_dir', displayName: '目录列表',
    canReadFiles: false, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '只返回文件/目录名列表；不读取文件内容。',
  },
  get_project_overview: {
    name: 'get_project_overview', displayName: '项目画像',
    canReadFiles: true, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low',
    sandboxNote: '聚合多个只读源（文件读取、AST 解析、记忆）生成项目概览，无写入或网络操作。',
  },
};

/** Return the permission record for every registered tool definition. */
export function getToolPermissionMatrix(): ToolPermission[] {
  // Defer TOOL_DEFINITIONS — function is called after the array is initialized
  return TOOL_DEFINITIONS.map(t => TOOL_PERMISSIONS[t.name] ?? {
    name: t.name,
    displayName: t.name,
    canReadFiles: false, canWriteFiles: false, canRunCommands: false, canAccessNetwork: false,
    requiresConfirmation: false, riskLevel: 'low' as const,
    sandboxNote: '无额外权限声明。',
  });
}

const RISK_ICON: Record<string, string> = { low: '🟢', medium: '🟡', high: '🔴' };

/**
 * Render a human-readable permission table for all registered tools.
 * Suitable for a /tools permissions command or the smoke script.
 */
export function renderToolPermissionTable(): string {
  const perms = getToolPermissionMatrix();
  const COL = { name: 14, r: 5, w: 5, cmd: 5, net: 5, confirm: 5 };
  const header = [
    '工具'.padEnd(COL.name), '读文件'.padEnd(COL.r), '写文件'.padEnd(COL.w),
    '命令'.padEnd(COL.cmd), '网络'.padEnd(COL.net), '需确认'.padEnd(COL.confirm), '风险',
  ].join(' │ ');
  const sep = '─'.repeat(header.length);
  const rows = perms.map(p => [
    p.displayName.slice(0, COL.name).padEnd(COL.name),
    (p.canReadFiles    ? '✓' : '─').padEnd(COL.r),
    (p.canWriteFiles   ? '✓' : '─').padEnd(COL.w),
    (p.canRunCommands  ? '✓' : '─').padEnd(COL.cmd),
    (p.canAccessNetwork ? '✓' : '─').padEnd(COL.net),
    (p.requiresConfirmation ? '✓' : '─').padEnd(COL.confirm),
    RISK_ICON[p.riskLevel],
  ].join(' │ '));
  return [header, sep, ...rows].join('\n');
}

/** Return the sandbox note for a specific tool, formatted for display. */
export function renderToolSandboxNote(toolName: string): string {
  const p = TOOL_PERMISSIONS[toolName];
  if (!p) return `${toolName}: 无沙箱说明。`;
  return `${p.displayName} [${RISK_ICON[p.riskLevel]} ${p.riskLevel}]\n  ${p.sandboxNote}`;
}

// ─────────────────────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: '读取项目文件内容。返回文件全文。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件相对于项目根目录的路径' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description: '在项目中搜索代码。支持正则表达式。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索模式（支持正则）' },
        path: { type: 'string', description: '限定搜索的目录（可选）' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'run_command',
    description: '执行本地命令（npm、git、测试、构建等）。高风险命令会触发确认。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        reason: { type: 'string', description: '执行原因' },
      },
      required: ['command'],
    },
  },
  {
    name: 'web_search',
    description: '搜索网络获取最新文档、错误信息、API 参考。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询' },
      },
      required: ['query'],
    },
  },
  {
    name: 'code_intel',
    description: '查询代码符号信息：查看导出、函数签名、类型定义。',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: '文件路径' },
        symbol: { type: 'string', description: '符号名称（可选，不指定则返回文件所有导出）' },
      },
      required: ['file'],
    },
  },
  {
    name: 'git_status',
    description: '查看 Git 状态：分支、变更文件、最近提交。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'status | log | diff | branch' },
      },
      required: [],
    },
  },
  {
    name: 'web_fetch',
    description: '抓取网页全文并提取正文内容（Markdown 格式）。用于获取网页的详细内容进行分析。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的网页 URL' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_dir',
    description: '列出目录中的文件和子目录。用于探索项目结构、发现可用文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要列出的目录路径（相对于项目根目录，默认为根目录）' },
      },
      required: [],
    },
  },
  {
    name: 'get_project_overview',
    description: '获取项目完整画像：技术栈、模块列表、构建文件、测试统计、API端点、架构模式。分析项目时优先调用此工具，一次获得全局视角。',
    parameters: {
      type: 'object',
      properties: {
        deep: { type: 'boolean', description: '是否深度扫描（含 AST 解析、调用图、架构检测）。默认 true' },
      },
      required: [],
    },
  },
  {
    name: 'read_pdf',
    description: '读取 PDF 文件内容。提取文本信息用于分析。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'PDF 文件路径（相对于项目根目录）' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_docx',
    description: '读取 Word (.docx) 文档，提取段落文本内容，用于分析文档规格、需求或说明。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '.docx 文件路径（相对于项目根目录）' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_xlsx',
    description: '读取 Excel (.xlsx) 表格，以 Tab 分隔文本返回各行数据，用于分析数据表、配置表或报告。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '.xlsx 文件路径（相对于项目根目录）' },
      },
      required: ['path'],
    },
  },
];

export function buildToolDefinitions(): ToolDefinition[] {
  const tools = [...TOOL_DEFINITIONS];
  if (!isWebSearchAvailable()) {
    return tools.filter(t => t.name !== 'web_search' && t.name !== 'web_fetch');
  }
  return tools;
}

export async function executeToolCall(name: string, args: Record<string, unknown>, rootPath: string, taskId?: string): Promise<string> {
  const startMs = Date.now();
  emitToolEvent({ phase: 'start', toolName: name, args, taskId });

  try {
    const raw = await _executeTool(name, args, rootPath);
    const success = !raw.startsWith('错误') && !raw.startsWith('命令执行失败') && !raw.startsWith('搜索错误');
    recordToolUse(name, success);

    // P1-3: Track attempt for adaptive retry
    if (taskId) {
      const summary = success
        ? (raw.includes('找到') ? 'found' : raw.includes('命令执行成功') ? 'ok' : 'ok')
        : raw.slice(0, 50);
      recordToolAttempt(taskId, name, args, summary);
    }

    const durationMs = Date.now() - startMs;
    emitToolEvent({
      phase: 'end', toolName: name, args, taskId,
      durationMs, success,
      resultSnippet: `${raw.length}chars`,
    });

    // P2: Append citation tag to knowledge-producing results
    const result = (success && CITE_TOOLS.has(name))
      ? raw + buildToolCitation(name, args, raw.length)
      : raw;

    return result;
  } catch (e) {
    const durationMs = Date.now() - startMs;
    recordToolUse(name, false);
    if (taskId) recordToolAttempt(taskId, name, args, 'error: ' + (e as Error).message.slice(0, 80));
    emitToolEvent({ phase: 'end', toolName: name, args, taskId, durationMs, success: false });
    return `工具执行异常: ${(e as Error).message}`;
  }
}

/** Resolve path: absolute paths used directly, relative paths joined with rootPath */
function resolvePath(p: string, rootPath: string): string {
  if (!p) return '';
  // Windows absolute: C:\... or D:\...
  if (/^[a-zA-Z]:[\\/]/.test(p)) return p;
  // Unix absolute
  if (p.startsWith('/')) return p;
  // Network path
  if (p.startsWith('\\\\')) return p;
  return [rootPath, p].join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

async function _executeTool(name: string, args: Record<string, unknown>, rootPath: string): Promise<string> {
  switch (name) {
    case 'read_file': {
      const filePath = (args.path as string) || '';
      if (!filePath) return '错误：缺少 path 参数';
      if (filePath.includes('..')) return '错误：不允许访问上级目录';
      const fullPath = resolvePath(filePath, rootPath);

      // Document file reading (pdf, html, pptx, docx, xlsx — skip for source code)
      const DOC_EXTENSIONS = new Set(['pdf', 'html', 'htm', 'pptx', 'ppt', 'docx', 'xlsx']);
      const fileExt = fullPath.split('.').pop()?.toLowerCase() || '';
      if (DOC_EXTENSIONS.has(fileExt)) {
        try {
          const { readDocumentFile } = await import('./doc-reader.js');
          const doc = await readDocumentFile(fullPath);
          if (doc) {
            const meta = [];
            if (doc.metadata.title) meta.push(`标题: ${doc.metadata.title}`);
            if (doc.metadata.pageCount) meta.push(`页数: ${doc.metadata.pageCount}`);
            const header = meta.length > 0 ? `[${doc.metadata.type.toUpperCase()} ${meta.join(', ')}]\n\n` : `[${doc.metadata.type.toUpperCase()}]\n\n`;
            return header + doc.text;
          }
        } catch { /* parse failed, fall through to raw read */ }
      }

      try {
        const content = await readFile(fullPath);
        const lines = content.split('\n');
        return compressFileContent(lines, lines.length);
      } catch { return `错误：无法读取 ${filePath}`; }
    }

    case 'search_code': {
      const pattern = (args.pattern as string) || '';
      if (!pattern) return '错误：缺少 pattern 参数';
      try {
        const { findFiles } = await import('../utils/fs.js');
        const searchPath = (args.path as string) || '';
        const globPattern = searchPath ? `${searchPath}/**/*` : '**/*';
        const files = await findFiles(rootPath, [globPattern]);
        const results: string[] = [];
        let count = 0;
        for (const file of files.slice(0, 30)) {
          try {
            const content = await readFile(file);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && count < 15; i++) {
              try {
                if (new RegExp(pattern, 'i').test(lines[i])) {
                  results.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
                  count++;
                }
              } catch { /* regex error */ }
            }
          } catch { /* skip */ }
        }
        if (results.length === 0) return `未找到匹配 "${pattern}" 的结果。建议: 尝试不同关键词或 read_file 直接查看文件。`;
        return compressSearchResults(results, 20, 5);
      } catch (e) { return `搜索错误：${(e as Error).message}`; }
    }

    case 'run_command': {
      const command = (args.command as string) || '';
      if (!command) return '错误：缺少 command 参数';

      // Dry-run mode: preview the command without executing
      if (args.dryRun) {
        const { adapted, wasAdapted } = await autoAdaptCommand(command, rootPath);
        const safety = isDangerousCmd(command) ? '⚠️ 危险命令（将被拦截）' : '✅ 安全策略通过';
        return [
          `[DRY-RUN] ${wasAdapted ? `适配后: ${adapted}` : command}`,
          `目录: ${rootPath || process.cwd()}`,
          safety,
        ].join('\n');
      }

      // Safety check — deny-list for dangerous operations
      if (isDangerousCmd(command)) return '错误：命令被安全策略拦截（危险操作）';

      // P1-4: Platform-aware auto-adaptation (auto-translate + execute)
      const { adapted, wasAdapted } = await autoAdaptCommand(command, rootPath);

      // Re-check adapted command — adaptation may have introduced danger
      if (wasAdapted && isDangerousCmd(adapted)) return '错误：命令适配后被安全策略拦截（危险操作）';

      try {
        const { execSync } = await import('child_process');
        const output = execSync(adapted, { cwd: rootPath, timeout: 30000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        const resultText = output || '(命令执行成功，无输出)';
        const compressed = compressCommandOutput(resultText);
        return wasAdapted ? `[已自动适配: ${adapted}]\n${compressed}` : compressed;
      } catch (e) {
        const hint = wasAdapted
          ? `命令执行失败：${(e as Error).message}。已自动适配为: ${adapted}。建议: 用 read_file 代替命令，或检查命令是否正确。`
          : `命令执行失败：${(e as Error).message}。建议: 用 read_file 代替命令，或检查命令是否正确。`;
        return hint;
      }
    }

    case 'web_search': {
      const query = (args.query as string) || '';
      if (!query) return '错误：缺少 query 参数';
      if (!isWebSearchAvailable()) return '网络搜索暂不可用';
      const results = await searchWeb(query, { maxResults: 3 });
      if (results.length === 0) return '未找到相关结果';
      return results.map(r => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n');
    }

    case 'code_intel': {
      const file = (args.file as string) || '';
      if (!file) return '错误：缺少 file 参数';
      try {
        const fullPath = resolvePath(file, rootPath);
        const { parseSourceFile } = await import('./ast-parser.js');
        const parsed = await parseSourceFile(fullPath);
        if (parsed.error) return `解析错误：${parsed.error}`;

        const symbol = args.symbol as string | undefined;
        if (symbol) {
          const match = parsed.exports.find(e => e.name === symbol);
          if (!match) return `未找到符号：${symbol}`;
          // Return symbol with callers and data flow if available
          const parts = [`${match.kind} ${match.name}: ${match.signature}`];
          const callers = parsed.callGraph.filter(e => e.callee === symbol);
          if (callers.length > 0) parts.push(`调用者 (${callers.length}): ${callers.map(c => c.caller).join(', ')}`);
          if (parsed.dataFlow?.length) {
            const symbolFlows = parsed.dataFlow.filter(df => df.def.name === symbol);
            if (symbolFlows.length > 0) parts.push(`数据流: ${symbolFlows[0].uses.length} 次使用`);
          }
          return parts.join('\n');
        }

        const lines: string[] = [];
        if (parsed.exports.length > 0) lines.push(`导出 (${parsed.exports.length}): ` + parsed.exports.map(e => `${e.kind} ${e.name}`).join(', '));
        if (parsed.functions.length > 0) lines.push(`函数 (${parsed.functions.length}): ` + parsed.functions.map(f => f.name).join(', '));
        if (parsed.classes.length > 0) lines.push(`类 (${parsed.classes.length}): ` + parsed.classes.map(c => c.name).join(', '));
        if (parsed.callGraph.length > 0) lines.push(`调用关系 (${parsed.callGraph.length}): ` + parsed.callGraph.slice(0, 8).map(e => `${e.caller}→${e.callee}`).join(', '));
        if (parsed.dataFlow?.length) lines.push(`数据流边 (${parsed.dataFlow.length})`);
        return lines.join('\n') || '无符号信息';
      } catch { return '代码智能暂不可用'; }
    }

    case 'git_status': {
      const action = (args.action as string) || 'status';
      // Allowlist: only known safe git read-only subcommands
      const ALLOWED: Record<string, string[]> = {
        status: ['status', '--short'],
        log: ['log', '--oneline', '-10'],
        diff: ['diff', '--stat'],
        branch: ['branch', '-a'],
      };
      const gitArgs = ALLOWED[action] || ALLOWED.status;
      try {
        const { execFileSync } = await import('child_process');
        const output = execFileSync('git', gitArgs, { cwd: rootPath, timeout: 10000, encoding: 'utf-8' });
        return output.slice(0, 1000) || '(无输出)';
      } catch { return 'Git 不可用或非 Git 仓库'; }
    }

    case 'web_fetch': {
      const url = (args.url as string) || '';
      if (!url) return '错误：缺少 url 参数';
      try {
        const { fetchWebPage } = await import('./web-fetcher.js');
        const page = await fetchWebPage(url, { timeout: 10000, maxContentLength: 20000 });
        return [
          `标题: ${page.title}`,
          page.siteName ? `来源: ${page.siteName}` : '',
          page.publishedAt ? `发布时间: ${page.publishedAt}` : '',
          `\n${page.content}`,
        ].filter(Boolean).join('\n');
      } catch (err) { return `网页抓取失败: ${(err as Error).message}`; }
    }

    case 'list_dir': {
      const dirPath = (args.path as string) || '.';
      try {
        const { listDir, fileExists } = await import('../utils/fs.js');
        const targetPath = resolvePath(dirPath, rootPath);
        if (!(await fileExists(targetPath))) return `错误：目录不存在 ${dirPath}`;
        const entries = await listDir(targetPath);
        if (entries.length === 0) return `目录 ${dirPath} 为空`;
        // Show with size info when possible
        const lines: string[] = [`目录 ${dirPath} (${entries.length} 项):`];
        for (const name of entries.slice(0, 50)) {
          const isDir = !name.includes('.') || name.endsWith('/');
          lines.push(`  ${isDir ? '📁' : '📄'} ${name}`);
        }
        if (entries.length > 50) lines.push(`  ... 共 ${entries.length} 项`);
        return lines.join('\n');
      } catch (err) { return `列出目录失败: ${(err as Error).message}`; }
    }

    case 'read_pdf': {
      const pdfPath = (args.path as string) || '';
      if (!pdfPath) return '错误：缺少 path 参数';
      const fullPath = resolvePath(pdfPath, rootPath);
      try {
        const pdfModule: any = await import('pdf-parse');
        const fsPromises = await import('fs/promises');
        const buf = await fsPromises.readFile(fullPath);
        const parser = new pdfModule.PDFParse(new Uint8Array(buf));
        await parser.load();
        const data: any = await parser.getText();
        const text = (data.text || '').trim();
        const numPages = data.pages?.length || data.total || '未知';
        if (!text) return `PDF 解析完成但无文本内容（可能为扫描件或图片 PDF）。页数: ${numPages}`;
        const maxLen = 15000;
        const truncated = text.length > maxLen ? text.slice(0, maxLen) + `\n...(PDF 共 ${numPages} 页，${text.length} 字符，已截断至 ${maxLen})` : text;
        return `PDF: ${pdfPath}\n页数: ${numPages}\n\n${truncated}`;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('password') || msg.includes('encrypted')) {
          return `PDF 加密: ${pdfPath} 需要密码才能读取。请提供密码或使用解密后的文件。`;
        }
        if (msg.includes('Cannot find module') || msg.includes('pdf-parse')) {
          return `PDF 读取不可用: pdf-parse 未安装。`;
        }
        return `PDF 读取失败: ${msg}`;
      }
    }

    case 'read_docx': {
      const docPath = (args.path as string) || '';
      if (!docPath) return '错误：缺少 path 参数';
      const fullDocPath = resolvePath(docPath, rootPath);
      try {
        const { readDocxFile } = await import('./doc-reader.js');
        const doc = await readDocxFile(fullDocPath);
        const titleTag = doc.metadata.title ? ` · ${doc.metadata.title}` : '';
        const header = `[DOCX${titleTag}]\n\n`;
        return header + doc.text;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('ENOENT')) return `错误：文件不存在 ${docPath}`;
        return `DOCX 读取失败: ${msg}`;
      }
    }

    case 'read_xlsx': {
      const xlsxPath = (args.path as string) || '';
      if (!xlsxPath) return '错误：缺少 path 参数';
      const fullXlsxPath = resolvePath(xlsxPath, rootPath);
      try {
        const { readXlsxFile } = await import('./doc-reader.js');
        const doc = await readXlsxFile(fullXlsxPath);
        const rowCount = doc.text ? doc.text.split('\n').length : 0;
        const header = `[XLSX · ${rowCount} 行]\n\n`;
        return header + doc.text;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('ENOENT')) return `错误：文件不存在 ${xlsxPath}`;
        return `XLSX 读取失败: ${msg}`;
      }
    }

    case 'get_project_overview': {
      const deep = args.deep !== false; // default true
      try {
        const { assembleContextFromProject } = await import('./context.js');
        const task: import('../types.js').Task = {
          id: `overview-${Date.now().toString(36)}`,
          description: '项目全景分析',
          status: 'queued',
          priority: 'normal',
          createdAt: new Date().toISOString(),
          changes: [],
          diffs: [],
          reasoning: [],
          errorLog: [],
          retryCount: 0,
          maxRetries: 1,
          agentExecutions: [],
        };
        const ctx = await assembleContextFromProject(rootPath, task, {
          maxTokens: 50000,
          scanIfMissing: true,
          deep,
          includeTests: true,
        });
        // Return the assembled project meta + relevant code summaries
        const lines: string[] = [];
        lines.push('## 项目画像');
        lines.push('');
        if (ctx.projectMeta) {
          lines.push(ctx.projectMeta);
        }
        if (ctx.relevantCode.length > 0) {
          lines.push(`\n## 关键代码文件 (${ctx.relevantCode.length} 个)`);
          lines.push(ctx.relevantCode.slice(0, 20).map(c =>
            `- ${c.file} (${c.compression})`
          ).join('\n'));
        }
        if (ctx.relevantMemory) {
          lines.push(`\n## 项目记忆`);
          lines.push(ctx.relevantMemory);
        }
        if (ctx.astHints) {
          lines.push(`\n## 代码调用关系`);
          lines.push(ctx.astHints);
        }
        lines.push(`\nToken 用量: ${ctx.totalTokens} / 预算: ${ctx.budgetUsed}%`);
        return lines.join('\n');
      } catch (err) {
        return `项目画像获取失败: ${(err as Error).message}。请尝试运行 /scan 初始化项目索引。`;
      }
    }

    default:
      return `未知工具：${name}`;
  }
}
