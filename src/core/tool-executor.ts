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
];

export function buildToolDefinitions(): ToolDefinition[] {
  const tools = [...TOOL_DEFINITIONS];
  if (!isWebSearchAvailable()) {
    return tools.filter(t => t.name !== 'web_search');
  }
  return tools;
}

export async function executeToolCall(name: string, args: Record<string, unknown>, rootPath: string): Promise<string> {
  try {
    const result = await _executeTool(name, args, rootPath);
    recordToolUse(name, !result.startsWith('错误') && !result.startsWith('命令执行失败') && !result.startsWith('搜索错误'));
    return result;
  } catch (e) {
    recordToolUse(name, false);
    return `工具执行异常: ${(e as Error).message}`;
  }
}

async function _executeTool(name: string, args: Record<string, unknown>, rootPath: string): Promise<string> {
  switch (name) {
    case 'read_file': {
      const filePath = (args.path as string) || '';
      if (!filePath) return '错误：缺少 path 参数';
      if (filePath.includes('..')) return '错误：不允许访问上级目录';
      const fullPath = [rootPath, filePath].join('/').replace(/\/+/g, '/');
      try {
        const content = await readFile(fullPath);
        const lines = content.split('\n');
        // TI3: Compress large results — skeleton mode for >200 lines
        if (lines.length > 200) {
          const keyLines = lines.filter((l, i) =>
            i < 30 || i > lines.length - 10 ||
            /^(import|export|function|class|interface|type|const|let|var|public|private|#|##|\/\/|func |def |package )/.test(l)
          );
          return keyLines.slice(0, 100).join('\n') + `\n... (${lines.length} 行，已压缩为关键行)`;
        }
        return content;
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
        // TI3: summary line
        return `找到 ${results.length} 条匹配:\n${results.join('\n')}${results.length >= 15 ? '\n(结果已截断，缩小搜索范围可获取更精确结果)' : ''}`;
      } catch (e) { return `搜索错误：${(e as Error).message}`; }
    }

    case 'run_command': {
      const command = (args.command as string) || '';
      if (!command) return '错误：缺少 command 参数';
      // TI2: Platform-aware adaptation
      const isWin = process.platform === 'win32';
      const unixOnly = /^(ls|find|grep|cat|sed|awk|tail|head|which|wget|curl)\b/i;
      if (isWin && unixOnly.test(command.trim())) {
        const alt: Record<string, string> = {
          ls: 'dir', find: 'dir /s /b', grep: 'findstr', cat: 'type',
          tail: 'powershell Get-Content -Tail', head: 'powershell Get-Content -Head',
          which: 'where', wget: 'curl -o', cp: 'copy', mv: 'move',
          mkdir: 'New-Item -ItemType Directory -Force', rm: 'Remove-Item',
          chmod: 'icacls', diff: 'Compare-Object', wc: 'Measure-Object -Line',
          sort: 'Sort-Object', uniq: 'Get-Unique', tar: 'Compress-Archive',
          env: 'Get-ChildItem env:', kill: 'Stop-Process', ps: 'Get-Process',
          awk: 'powershell -Command', sed: 'powershell -Command',
          xargs: 'ForEach-Object', uname: 'Get-ComputerInfo',
        };
        const cmd = command.trim().split(/\s+/)[0].toLowerCase();
        return `平台: Windows。命令 "${cmd}" 不可用。替代: ${alt[cmd] || 'powershell Get-ChildItem'}。请改用替代命令或 read_file 代替。`;
      }
      const dangerous = /rm\s+-r|rm\s+-f|sudo|chmod\s+777|>\/dev\/|mkfs|dd\s+if=|fork\s*bomb|del\s+\/f|format\s+[a-z]:|diskpart/i;
      if (dangerous.test(command)) return '错误：命令被安全策略拦截（危险操作）';
      try {
        const { execSync } = await import('child_process');
        const output = execSync(command, { cwd: rootPath, timeout: 30000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        // TI3: Truncate large output
        return (output || '(命令执行成功，无输出)').slice(0, 1500);
      } catch (e) { return `命令执行失败：${(e as Error).message}。建议: 用 read_file 代替命令，或检查命令是否正确。`; }
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
        const fullPath = [rootPath, file].join('/').replace(/\/+/g, '/');
        const { parseSourceFile } = await import('./ast-parser.js');
        const parsed = await parseSourceFile(fullPath);
        if (parsed.error) return `解析错误：${parsed.error}`;

        const symbol = args.symbol as string | undefined;
        if (symbol) {
          const match = parsed.exports.find(e => e.name === symbol);
          if (match) return `${match.kind} ${match.name}: ${match.signature}`;
          return `未找到符号：${symbol}`;
        }

        const lines: string[] = [];
        if (parsed.exports.length > 0) lines.push(`导出 (${parsed.exports.length}): ` + parsed.exports.map(e => `${e.kind} ${e.name}`).join(', '));
        if (parsed.functions.length > 0) lines.push(`函数 (${parsed.functions.length}): ` + parsed.functions.map(f => f.name).join(', '));
        if (parsed.classes.length > 0) lines.push(`类 (${parsed.classes.length}): ` + parsed.classes.map(c => c.name).join(', '));
        return lines.join('\n') || '无符号信息';
      } catch { return '代码智能暂不可用'; }
    }

    case 'git_status': {
      const action = (args.action as string) || 'status';
      try {
        const { execSync } = await import('child_process');
        const cmd = action === 'log' ? 'git log --oneline -10' :
          action === 'diff' ? 'git diff --stat' :
          action === 'branch' ? 'git branch -a' : 'git status --short';
        const output = execSync(cmd, { cwd: rootPath, timeout: 10000, encoding: 'utf-8' });
        return output.slice(0, 1000) || '(无输出)';
      } catch { return 'Git 不可用或非 Git 仓库'; }
    }

    default:
      return `未知工具：${name}`;
  }
}
