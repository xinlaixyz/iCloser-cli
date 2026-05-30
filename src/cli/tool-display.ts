import { C } from './theme.js';
import type { ToolLoopProgress } from '../core/tool-loop.js';

/** Icon per tool name; unknown tools fall back to 🔧. */
export const TOOL_ICONS: Record<string, string> = {
  read_file: '📖',
  read_docx: '📝',
  read_xlsx: '📊',
  read_pdf: '📄',
  search_code: '🔍',
  run_command: '⚡',
  web_search: '🌐',
  web_fetch: '🌐',
  code_intel: '🔬',
  git_status: '🌿',
  list_dir: '📁',
  get_project_overview: '🗺',
};

/** One-line argument hint shown next to the tool name. */
export function extractToolHint(toolName: string, args: Record<string, unknown>): string {
  const raw = String(args.path ?? args.file ?? args.url ?? args.pattern ?? args.query ?? args.command ?? '');
  if (!raw) return '';
  switch (toolName) {
    case 'search_code': return `/${raw.slice(0, 40)}/`;
    case 'web_search':  return `"${raw.slice(0, 40)}"`;
    case 'run_command': return `$ ${raw.slice(0, 45)}`;
    default:            return raw.slice(0, 50);
  }
}

/** Beginner-readable reason shown before a tool call. */
export function explainToolPurpose(toolName: string): string {
  switch (toolName) {
    case 'get_project_overview': return '先建立项目全貌';
    case 'list_dir': return '查看目录结构';
    case 'read_file': return '读取关键文件';
    case 'read_docx': return '读取 Word 文档';
    case 'read_xlsx': return '读取表格数据';
    case 'read_pdf': return '读取 PDF 内容';
    case 'search_code': return '定位相关代码';
    case 'code_intel': return '分析代码关系';
    case 'run_command': return '执行验证命令';
    case 'web_search': return '搜索外部信息';
    case 'web_fetch': return '抓取网页内容';
    case 'git_status': return '检查变更状态';
    default: return '调用工程工具';
  }
}

/** Short content preview extracted from a tool result string. */
export function extractResultPreview(toolName: string, result: string): string {
  if (!result) return '';
  if (result.startsWith('[cache reused]')) return 'reused from cache';
  const isError = result.startsWith('错误') || result.startsWith('未找到') ||
                  result.startsWith('工具执行') || result.startsWith('DOCX 读取') ||
                  result.startsWith('XLSX 读取');
  if (isError) return '';

  switch (toolName) {
    case 'search_code': {
      const countMatch = result.match(/找到 (\d+) 条/);
      const firstHit = result.split('\n').find(l => /:\d+:/.test(l))?.trim();
      return countMatch
        ? `${countMatch[1]} 条${firstHit ? ` · ${firstHit.slice(0, 50)}` : ''}`
        : '';
    }
    case 'web_search': {
      const m = result.match(/^\[([^\]]+)\]/m);
      return m ? m[1].slice(0, 55) : '';
    }
    case 'web_fetch': {
      const line = result.split('\n').find(l => l.startsWith('标题:'));
      return line ? line.replace('标题:', '').trim().slice(0, 55) : '';
    }
    case 'list_dir': {
      const m = result.match(/\((\d+) 项\)/);
      return m ? `${m[1]} 项` : '';
    }
    case 'code_intel': {
      const line = result.split('\n').find(l => l.startsWith('导出'));
      return line ? line.slice(0, 60) : result.split('\n')[0]?.trim().slice(0, 60) ?? '';
    }
    case 'git_status': {
      return result.split('\n')[0]?.trim().slice(0, 55) ?? '';
    }
    case 'run_command': {
      const lines = result.split('\n').filter(l => !l.startsWith('[已自动适配'));
      return lines[0]?.trim().slice(0, 55) ?? '';
    }
    case 'read_file':
    case 'read_docx':
    case 'read_xlsx':
    case 'read_pdf': {
      const lines = result.split('\n')
        .filter(l => l.trim() && !l.startsWith('[') && !l.startsWith('#') && !l.startsWith('标题:') && !l.startsWith('页数:'));
      return lines[0]?.trim().slice(0, 60) ?? '';
    }
    default:
      return result.split('\n')[0]?.trim().slice(0, 60) ?? '';
  }
}

export interface ToolProgressDisplay {
  handle(event: ToolLoopProgress): void;
}

export function createToolProgressDisplay(write: (text: string) => void = text => process.stdout.write(text)): ToolProgressDisplay {
  let lastCall: { toolName: string; icon: string; hint: string } | null = null;
  let toolCount = 0;
  let toolsHeaderPrinted = false;

  return {
    handle(ev: ToolLoopProgress): void {
      if (ev.phase === 'thinking') {
        write(`\r\x1b[K  ${C.primary('●')} ${C.dim(`Round ${ev.round}`)}  ${C.dim('AI 分析中...')}`);
        return;
      }

      if (ev.phase === 'tool_call') {
        if (!toolsHeaderPrinted) {
          toolsHeaderPrinted = true;
          write(`\r\x1b[K\n  ${C.dim('工具执行')} ${C.dim('AI 会边做边展示证据，失败会进入恢复路径')}\n`);
        }
        toolCount++;
        const args = ev.toolArgs ?? {};
        const icon = TOOL_ICONS[ev.toolName ?? ''] ?? '🔧';
        const hint = extractToolHint(ev.toolName ?? '', args);
        const purpose = explainToolPurpose(ev.toolName ?? '');
        lastCall = { toolName: ev.toolName ?? '', icon, hint };
        write(`\r\x1b[K  ${icon} ${C.dim((ev.toolName ?? '').padEnd(12))}${hint ? `  ${C.dim(hint)}` : ''}  ${C.dim('·')} ${C.dim(purpose)}`);
        return;
      }

      if (ev.phase === 'tool_result') {
        const len = ev.resultLength ?? ev.toolResult?.length ?? 0;
        const lenStr = len >= 1024 ? `${(len / 1024).toFixed(1)}K` : `${len}`;
        const raw = ev.toolResult ?? '';
        const reused = raw.startsWith('[cache reused]');
        const isErr = raw.startsWith('错误') || raw.startsWith('未找到') ||
                      raw.startsWith('工具执行') || raw.startsWith('⚠️');
        const status = reused ? C.info('↻') : isErr ? C.warn('⚠') : C.success('✓');
        const preview = extractResultPreview(ev.toolName ?? '', raw);
        const { icon = '🔧', hint = '', toolName = ev.toolName ?? '' } = lastCall ?? {};
        lastCall = null;
        write(`\r\x1b[K  ${icon} ${C.dim(toolName.padEnd(12))}${hint ? `  ${C.dim(hint)}` : ''}  ${status} ${C.dim(lenStr + '字符')}${preview ? `  ${C.dim('·')} ${C.dim(preview)}` : ''}\n`);
        return;
      }

      if (ev.phase === 'synthesizing') {
        write(`\r\x1b[K  ${C.primary('●')} ${C.dim('整合结果...')}`);
        return;
      }

      if (ev.phase === 'done') {
        const toolSuffix = toolCount > 0 ? ` · ${toolCount} 次工具调用` : '';
        write(`\r\x1b[K  ${C.success('●')} ${C.dim(`${ev.round} 轮${toolSuffix}`)}\n\n`);
      }
    },
  };
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}
