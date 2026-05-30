/**
 * repl-tool-viz.test.ts — unit tests for T4 visualization helpers
 *
 * extractToolHint   — formats the argument hint shown next to the tool name
 * extractResultPreview — extracts a short content preview from a tool result
 */
import { describe, it, expect } from 'vitest';
import { createToolProgressDisplay, explainToolPurpose, extractToolHint, extractResultPreview, stripAnsi } from '../src/cli/tool-display.js';

// ── extractToolHint ───────────────────────────────────────────────────────────

describe('extractToolHint', () => {
  it('read_file: returns path as-is (≤50 chars)', () => {
    expect(extractToolHint('read_file', { path: 'src/utils/fs.ts' })).toBe('src/utils/fs.ts');
  });

  it('read_file: truncates long path to 50 chars', () => {
    const long = 'src/' + 'a'.repeat(60);
    expect(extractToolHint('read_file', { path: long })).toHaveLength(50);
  });

  it('search_code: wraps pattern in slashes', () => {
    expect(extractToolHint('search_code', { pattern: 'createTask' })).toBe('/createTask/');
  });

  it('search_code: truncates long pattern', () => {
    const long = 'x'.repeat(50);
    const result = extractToolHint('search_code', { pattern: long });
    expect(result).toMatch(/^\/.+\/$/);
    expect(result.length).toBeLessThanOrEqual(42); // /40-chars/
  });

  it('web_search: wraps query in quotes', () => {
    expect(extractToolHint('web_search', { query: 'TypeScript generics' })).toBe('"TypeScript generics"');
  });

  it('run_command: prepends $', () => {
    expect(extractToolHint('run_command', { command: 'npm test' })).toBe('$ npm test');
  });

  it('run_command: truncates long command', () => {
    const long = 'npx vitest run ' + 'x'.repeat(60);
    const result = extractToolHint('run_command', { command: long });
    expect(result.startsWith('$ ')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(47); // $ + 45
  });

  it('web_fetch: returns url', () => {
    expect(extractToolHint('web_fetch', { url: 'https://example.com' })).toBe('https://example.com');
  });

  it('returns empty string when no recognised arg', () => {
    expect(extractToolHint('git_status', { action: 'status' })).toBe('');
  });

  it('code_intel: uses file arg', () => {
    expect(extractToolHint('code_intel', { file: 'src/index.ts' })).toBe('src/index.ts');
  });
});

// ── extractResultPreview ──────────────────────────────────────────────────────

describe('extractResultPreview', () => {
  // --- search_code ---
  it('search_code: extracts match count and first hit', () => {
    const result = '找到 5 条匹配:\nsrc/core/task-engine.ts:42: export function createTask\nsrc/core/task-pipeline.ts:88: createTask(';
    const preview = extractResultPreview('search_code', result);
    expect(preview).toContain('5 条');
    expect(preview).toContain('task-engine.ts');
  });

  it('search_code: returns empty string on error result', () => {
    expect(extractResultPreview('search_code', '未找到匹配 "xyz" 的结果。')).toBe('');
  });

  it('search_code: handles no count line gracefully', () => {
    const preview = extractResultPreview('search_code', 'some output without count');
    expect(typeof preview).toBe('string');
  });

  // --- web_search ---
  it('web_search: extracts first result title', () => {
    const result = '[TypeScript Handbook](https://www.typescriptlang.org/docs/)\nThe official TypeScript docs.';
    const preview = extractResultPreview('web_search', result);
    expect(preview).toContain('TypeScript Handbook');
  });

  it('web_search: returns empty for empty result', () => {
    expect(extractResultPreview('web_search', '')).toBe('');
  });

  // --- web_fetch ---
  it('web_fetch: extracts 标题 line', () => {
    const result = '标题: Example Domain\n来源: example.com\n\nThis domain is for use...';
    const preview = extractResultPreview('web_fetch', result);
    expect(preview).toBe('Example Domain');
  });

  it('web_fetch: returns empty when no 标题 line', () => {
    const result = '来源: example.com\n\nSome content here';
    expect(extractResultPreview('web_fetch', result)).toBe('');
  });

  // --- list_dir ---
  it('list_dir: extracts item count', () => {
    const result = '目录 src (12 项):\n  📁 core\n  📄 index.ts';
    const preview = extractResultPreview('list_dir', result);
    expect(preview).toBe('12 项');
  });

  // --- code_intel ---
  it('code_intel: extracts exports line', () => {
    const result = '导出 (5): function createTask, function persistTask, function loadTask, function listTasks, interface Task';
    const preview = extractResultPreview('code_intel', result);
    expect(preview).toContain('导出');
    expect(preview).toContain('createTask');
  });

  // --- run_command ---
  it('run_command: returns first non-adaptation line', () => {
    const result = '> project@1.0.0 test\nAll tests passed\n✓ 45 tests';
    const preview = extractResultPreview('run_command', result);
    expect(preview).toBe('> project@1.0.0 test');
  });

  it('run_command: skips auto-adaptation prefix', () => {
    const result = '[已自动适配: dir /b]\n Volume in drive C\n Directory of C:\\';
    const preview = extractResultPreview('run_command', result);
    expect(preview).not.toContain('已自动适配');
  });

  // --- read_file ---
  it('read_file: skips [HEADER] lines and returns first content line', () => {
    const result = '[DOCX · My Document]\n\n第一章 概述\n本文档描述...';
    const preview = extractResultPreview('read_docx', result);
    expect(preview).toBe('第一章 概述');
  });

  it('read_file: returns first non-empty non-header line', () => {
    const result = 'import { foo } from \'bar\';\n\nexport function doThing() {';
    const preview = extractResultPreview('read_file', result);
    expect(preview).toContain('import');
  });

  // --- error handling ---
  it('returns empty string for 错误 results (any tool)', () => {
    expect(extractResultPreview('read_file',    '错误：文件不存在 foo.ts')).toBe('');
    expect(extractResultPreview('run_command',  '工具执行异常: ...')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(extractResultPreview('read_file', '')).toBe('');
    expect(extractResultPreview('unknown_tool', '')).toBe('');
  });

  // --- default / unknown tool ---
  it('default: returns first non-empty line truncated to 60 chars', () => {
    const result = 'First line of output\nSecond line';
    const preview = extractResultPreview('unknown_tool', result);
    expect(preview).toBe('First line of output');
    expect(preview.length).toBeLessThanOrEqual(60);
  });
});

describe('createToolProgressDisplay', () => {
  it('explains tool purpose in beginner-readable language', () => {
    expect(explainToolPurpose('read_file')).toBe('读取关键文件');
    expect(explainToolPurpose('run_command')).toBe('执行验证命令');
    expect(explainToolPurpose('unknown')).toBe('调用工程工具');
  });

  it('renders a single completed line for a tool call/result pair', () => {
    let output = '';
    const display = createToolProgressDisplay(text => { output += text; });

    display.handle({ phase: 'tool_call', round: 1, message: '', toolName: 'read_file', toolArgs: { path: 'src/index.ts' } });
    display.handle({ phase: 'tool_result', round: 1, message: '', toolName: 'read_file', toolResult: 'export const x = 1;', resultLength: 19 });

    const clean = stripAnsi(output);
    expect(clean).toContain('read_file');
    expect(clean).toContain('src/index.ts');
    expect(clean).toContain('读取关键文件');
    expect(clean).toContain('export const x');
    expect(clean.endsWith('\n')).toBe(true);
  });

  it('renders done with accumulated tool count', () => {
    let output = '';
    const display = createToolProgressDisplay(text => { output += text; });

    display.handle({ phase: 'tool_call', round: 1, message: '', toolName: 'list_dir', toolArgs: { path: '.' } });
    display.handle({ phase: 'tool_result', round: 1, message: '', toolName: 'list_dir', toolResult: '目录 . (3 项):', resultLength: 10 });
    display.handle({ phase: 'done', round: 2, message: 'done' });

    expect(stripAnsi(output)).toContain('2 轮 · 1 次工具调用');
  });
});
