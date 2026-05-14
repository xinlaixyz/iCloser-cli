// Tool Executor — bridges AI tool calls to local capabilities
import { readFile, fileExists } from '../utils/fs.js';
import { searchWeb } from './web-search.js';
import { isWebSearchAvailable } from './web-search.js';
import type { ToolDefinition } from '../ai/provider.js';

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: string;
  error?: string;
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
];

export function buildToolDefinitions(): ToolDefinition[] {
  const tools = [...TOOL_DEFINITIONS];
  if (!isWebSearchAvailable()) {
    return tools.filter(t => t.name !== 'web_search');
  }
  return tools;
}

export async function executeToolCall(name: string, args: Record<string, unknown>, rootPath: string): Promise<string> {
  switch (name) {
    case 'read_file': {
      const filePath = (args.path as string) || '';
      if (!filePath) return '错误：缺少 path 参数';
      if (filePath.includes('..')) return '错误：不允许访问上级目录';
      const fullPath = [rootPath, filePath].join('/').replace(/\/+/g, '/');
      try {
        const content = await readFile(fullPath);
        const lines = content.split('\n');
        if (lines.length > 200) return lines.slice(0, 200).join('\n') + `\n... (${lines.length - 200} 行省略)`;
        return content;
      } catch { return `错误：无法读取 ${filePath}`; }
    }

    case 'search_code': {
      const pattern = (args.pattern as string) || '';
      if (!pattern) return '错误：缺少 pattern 参数';
      // Use grep-like search via scanner patterns
      try {
        const { findFiles } = await import('../utils/fs.js');
        const searchPath = (args.path as string) || '';
        const globPattern = searchPath ? `${searchPath}/**/*` : '**/*';
        const files = await findFiles(rootPath, [globPattern]);
        const results: string[] = [];
        let count = 0;
        for (const file of files.slice(0, 50)) {
          try {
            const content = await readFile(file);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && count < 20; i++) {
              try {
                if (new RegExp(pattern, 'i').test(lines[i])) {
                  results.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
                  count++;
                }
              } catch { /* regex error on line */ }
            }
          } catch { /* skip unreadable */ }
        }
        if (results.length === 0) return `未找到匹配 "${pattern}" 的结果`;
        return results.join('\n');
      } catch (e) { return `搜索错误：${(e as Error).message}`; }
    }

    case 'run_command': {
      const command = (args.command as string) || '';
      if (!command) return '错误：缺少 command 参数';
      // Only allow safe commands
      const dangerous = /rm\s+-rf|sudo|chmod\s+777|>\/dev\/|mkfs|dd\s+if=|:\(\)\s*\{/i;
      if (dangerous.test(command)) return '错误：命令被安全策略拦截';
      try {
        const { execSync } = await import('child_process');
        const output = execSync(command, { cwd: rootPath, timeout: 30000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        return output.slice(0, 2000) || '(命令执行成功，无输出)';
      } catch (e) { return `命令执行失败：${(e as Error).message}`; }
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

    default:
      return `未知工具：${name}`;
  }
}
