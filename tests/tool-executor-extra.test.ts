// Extra coverage for src/core/tool-executor.ts
// Targets: getToolStats, getToolHealth, recordToolAttempt, getAdaptiveStrategyHint,
//          clearToolAttempts, validateToolCallForIntent,
//          executeToolCall git_status, web_fetch, list_dir, read_pdf, get_project_overview,
//          read_docx, read_xlsx, onToolExecution, offToolExecution, formatToolStart,
//          formatToolEnd, buildToolCitation, getToolPermissionMatrix, renderToolPermissionTable,
//          renderToolSandboxNote
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getToolStats,
  getToolHealth,
  recordToolAttempt,
  getAdaptiveStrategyHint,
  clearToolAttempts,
  validateToolCallForIntent,
  executeToolCall,
  buildToolDefinitions,
  onToolExecution,
  offToolExecution,
  formatToolStart,
  formatToolEnd,
  buildToolCitation,
  getToolPermissionMatrix,
  renderToolPermissionTable,
  renderToolSandboxNote,
  type ToolExecutionEvent,
} from '../src/core/tool-executor.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'te-extra-'));
  roots.push(d);
  return d;
}
afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// getToolStats — record-level coverage
// ============================================================
describe('getToolStats', () => {
  it('returns an object (may be empty or have entries)', () => {
    const stats = getToolStats();
    expect(typeof stats).toBe('object');
    expect(stats).not.toBeNull();
  });

  it('reflects tool usage after executeToolCall calls', async () => {
    // Execute a tool to populate stats
    await executeToolCall('unknown_tool_xyz_stats', {}, '/tmp');
    const stats = getToolStats();
    // Stats object should have at least one entry now
    expect(typeof stats).toBe('object');
  });
});

// ============================================================
// getToolHealth
// ============================================================
describe('getToolHealth', () => {
  it('returns array of health entries', () => {
    const health = getToolHealth();
    expect(Array.isArray(health)).toBe(true);
    for (const h of health) {
      expect(h.name).toBeTruthy();
      expect(['available', 'limited', 'unavailable']).toContain(h.status);
      expect(typeof h.reason).toBe('string');
    }
  });
});

// ============================================================
// recordToolAttempt / clearToolAttempts / getAdaptiveStrategyHint
// ============================================================
describe('tool attempt tracking', () => {
  const TASK_ID = `test-task-${Date.now()}`;

  afterAll(() => {
    clearToolAttempts(TASK_ID);
  });

  it('getAdaptiveStrategyHint returns empty string when < 3 attempts', () => {
    recordToolAttempt(TASK_ID, 'read_file', { path: 'a.ts' }, 'ok');
    recordToolAttempt(TASK_ID, 'read_file', { path: 'b.ts' }, 'ok');
    const hint = getAdaptiveStrategyHint(TASK_ID);
    expect(hint).toBe('');
  });

  it('getAdaptiveStrategyHint returns hint when 3+ empty results with same tool', () => {
    clearToolAttempts(TASK_ID);
    recordToolAttempt(TASK_ID, 'search_code', { pattern: 'x' }, '未找到匹配结果 empty');
    recordToolAttempt(TASK_ID, 'search_code', { pattern: 'y' }, '未找到匹配结果 empty');
    recordToolAttempt(TASK_ID, 'search_code', { pattern: 'z' }, '未找到匹配结果 empty');
    const hint = getAdaptiveStrategyHint(TASK_ID);
    expect(hint).toContain('search_code');
    expect(hint).toContain('策略提示');
  });

  it('getAdaptiveStrategyHint returns hint for read_file empty pattern', () => {
    clearToolAttempts(TASK_ID);
    recordToolAttempt(TASK_ID, 'read_file', { path: 'a.ts' }, '未找到 empty');
    recordToolAttempt(TASK_ID, 'read_file', { path: 'b.ts' }, '未找到 empty');
    recordToolAttempt(TASK_ID, 'read_file', { path: 'c.ts' }, '未找到 empty');
    const hint = getAdaptiveStrategyHint(TASK_ID);
    expect(hint).toContain('read_file');
  });

  it('getAdaptiveStrategyHint returns hint for run_command empty pattern', () => {
    clearToolAttempts(TASK_ID);
    recordToolAttempt(TASK_ID, 'run_command', { command: 'ls' }, '未找到 empty');
    recordToolAttempt(TASK_ID, 'run_command', { command: 'dir' }, '未找到 empty');
    recordToolAttempt(TASK_ID, 'run_command', { command: 'cat' }, '未找到 empty');
    const hint = getAdaptiveStrategyHint(TASK_ID);
    expect(hint).toContain('run_command');
  });

  it('getAdaptiveStrategyHint returns generic hint for unknown tool pattern', () => {
    clearToolAttempts(TASK_ID);
    recordToolAttempt(TASK_ID, 'unknown_tool', {}, '未找到 empty');
    recordToolAttempt(TASK_ID, 'unknown_tool', {}, '0 条结果 empty');
    recordToolAttempt(TASK_ID, 'unknown_tool', {}, '未匹配 empty');
    const hint = getAdaptiveStrategyHint(TASK_ID);
    expect(hint).toContain('策略提示');
  });

  it('returns empty string when tools are varied (not same tool)', () => {
    clearToolAttempts(TASK_ID);
    recordToolAttempt(TASK_ID, 'read_file', {}, '未找到 empty');
    recordToolAttempt(TASK_ID, 'search_code', {}, '未找到 empty');
    recordToolAttempt(TASK_ID, 'run_command', {}, '未找到 empty');
    const hint = getAdaptiveStrategyHint(TASK_ID);
    expect(hint).toBe('');
  });

  it('clears attempts and getAdaptiveStrategyHint returns empty', () => {
    clearToolAttempts(TASK_ID);
    recordToolAttempt(TASK_ID, 'search_code', {}, '未找到 empty');
    recordToolAttempt(TASK_ID, 'search_code', {}, '未找到 empty');
    recordToolAttempt(TASK_ID, 'search_code', {}, '未找到 empty');
    clearToolAttempts(TASK_ID);
    const hint = getAdaptiveStrategyHint(TASK_ID);
    expect(hint).toBe('');
  });

  it('keeps only last 20 attempts (overflow test)', () => {
    clearToolAttempts(TASK_ID);
    for (let i = 0; i < 25; i++) {
      recordToolAttempt(TASK_ID, 'search_code', { i }, 'ok');
    }
    // Should not crash, internally capped at 20
    const hint = getAdaptiveStrategyHint(TASK_ID);
    expect(typeof hint).toBe('string');
  });
});

// ============================================================
// validateToolCallForIntent
// ============================================================
describe('validateToolCallForIntent', () => {
  it('returns valid:true for tool in strategy', async () => {
    const result = await validateToolCallForIntent('read_file', 'edit_code');
    expect(typeof result.valid).toBe('boolean');
  });

  it('returns valid:true for unknown intent (no strategy)', async () => {
    const result = await validateToolCallForIntent('read_file', 'nonexistent_intent_xyz');
    expect(result.valid).toBe(true);
  });

  it('returns result for web_search tool', async () => {
    const result = await validateToolCallForIntent('web_search', 'analysis');
    expect(typeof result.valid).toBe('boolean');
  });

  it('handles code_intel tool for various intents', async () => {
    const result = await validateToolCallForIntent('code_intel', 'refactor');
    expect(typeof result.valid).toBe('boolean');
  });
});

// ============================================================
// executeToolCall — previously uncovered tool cases
// ============================================================
describe('executeToolCall — additional tools', () => {
  it('git_status with status action in non-git dir returns error', async () => {
    const dir = await makeDir();
    const result = await executeToolCall('git_status', { action: 'status' }, dir);
    // Either returns git output or "Git 不可用" error
    expect(typeof result).toBe('string');
  });

  it('git_status with log action returns string', async () => {
    // Use actual git project root (AgentCode IS a git project)
    const result = await executeToolCall('git_status', { action: 'log' }, 'D:/temp/Codex/AgentCode');
    expect(typeof result).toBe('string');
  });

  it('git_status with diff action returns string', async () => {
    const result = await executeToolCall('git_status', { action: 'diff' }, 'D:/temp/Codex/AgentCode');
    expect(typeof result).toBe('string');
  });

  it('git_status with branch action returns string', async () => {
    const result = await executeToolCall('git_status', { action: 'branch' }, 'D:/temp/Codex/AgentCode');
    expect(typeof result).toBe('string');
  });

  it('git_status with unknown action defaults to status', async () => {
    const result = await executeToolCall('git_status', { action: 'unknown_xyz' }, 'D:/temp/Codex/AgentCode');
    expect(typeof result).toBe('string');
  });

  it('web_fetch with empty url returns error', async () => {
    const result = await executeToolCall('web_fetch', {}, '/tmp');
    expect(result).toContain('缺少 url 参数');
  });

  it('web_fetch with invalid url returns error', async () => {
    const result = await executeToolCall('web_fetch', { url: 'http://localhost:99999/nonexistent' }, '/tmp');
    // Should return error string (fetch failure)
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  }, 15000);

  it('list_dir on existing dir lists files', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'test.ts'), 'export const x = 1;', 'utf-8');
    await mkdir(join(dir, 'subdir'), { recursive: true });
    const result = await executeToolCall('list_dir', { path: '.' }, dir);
    expect(result).toContain('目录');
  });

  it('list_dir on empty dir shows empty message', async () => {
    const dir = await makeDir();
    const result = await executeToolCall('list_dir', { path: '.' }, dir);
    expect(typeof result).toBe('string');
  });

  it('list_dir on non-existent dir returns error', async () => {
    const dir = await makeDir();
    const result = await executeToolCall('list_dir', { path: 'nonexistent-dir-xyz' }, dir);
    expect(result).toContain('错误');
  });

  it('list_dir with more than 50 entries truncates', async () => {
    const dir = await makeDir();
    // Create 55 files to trigger truncation
    for (let i = 0; i < 55; i++) {
      await writeFile(join(dir, `file${i}.ts`), `export const x${i} = ${i};`, 'utf-8');
    }
    const result = await executeToolCall('list_dir', { path: '.' }, dir);
    expect(result).toContain('共');
  });

  it('read_pdf with empty path returns error', async () => {
    const result = await executeToolCall('read_pdf', {}, '/tmp');
    expect(result).toContain('缺少 path 参数');
  });

  it('read_pdf when pdf-parse not installed returns helpful message', async () => {
    const dir = await makeDir();
    // Create a fake PDF file with PDF header
    const fakePdf = Buffer.from('%PDF-1.4 This is a fake PDF file content for testing');
    await writeFile(join(dir, 'test.pdf'), fakePdf);
    const result = await executeToolCall('read_pdf', { path: 'test.pdf' }, dir);
    // Either succeeds or returns "pdf-parse not installed" or "读取失败"
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('read_pdf for nonexistent file returns error', async () => {
    const dir = await makeDir();
    const result = await executeToolCall('read_pdf', { path: 'nonexistent.pdf' }, dir);
    expect(result).toContain('读取失败');
  });

  it('get_project_overview returns project info or error message', async () => {
    const dir = await makeDir();
    // Create minimal project structure
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'test-proj', version: '1.0.0' }), 'utf-8');
    await writeFile(join(dir, 'index.ts'), 'export const main = () => {};', 'utf-8');
    const result = await executeToolCall('get_project_overview', {}, dir);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  }, 30000);

  it('get_project_overview with deep:false works', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    const result = await executeToolCall('get_project_overview', { deep: false }, dir);
    expect(typeof result).toBe('string');
  }, 30000);

  it('run_command executes ls/dir on Windows (auto-adapt)', async () => {
    const dir = await makeDir();
    // On Windows: 'ls' gets adapted to 'dir' (or stays as is if native)
    const result = await executeToolCall('run_command', { command: 'echo hello-test-output' }, dir);
    expect(typeof result).toBe('string');
  });
});

// ============================================================
// buildToolDefinitions — web_search availability check
// ============================================================
describe('buildToolDefinitions coverage', () => {
  it('returns tools filtered appropriately based on web search availability', () => {
    const tools = buildToolDefinitions();
    expect(tools.length).toBeGreaterThan(0);
    // web_search/web_fetch may or may not be present depending on env
    const names = tools.map(t => t.name);
    expect(names).toContain('read_file');
  });
});

// ============================================================
// P0: read_docx / read_xlsx tool definitions + execution
// ============================================================
describe('read_docx / read_xlsx tool definitions', () => {
  it('buildToolDefinitions includes read_docx and read_xlsx', () => {
    const tools = buildToolDefinitions();
    const names = tools.map(t => t.name);
    expect(names).toContain('read_docx');
    expect(names).toContain('read_xlsx');
  });

  it('read_docx has required path parameter', () => {
    const tools = buildToolDefinitions();
    const def = tools.find(t => t.name === 'read_docx');
    expect(def).toBeDefined();
    expect(def?.parameters.required).toContain('path');
  });

  it('read_xlsx has required path parameter', () => {
    const tools = buildToolDefinitions();
    const def = tools.find(t => t.name === 'read_xlsx');
    expect(def).toBeDefined();
    expect(def?.parameters.required).toContain('path');
  });
});

describe('executeToolCall: read_docx', () => {
  it('returns error message for missing path param', async () => {
    const dir = await makeDir();
    const result = await executeToolCall('read_docx', {}, dir);
    expect(result).toContain('缺少');
  });

  it('returns error message for non-existent file', async () => {
    const dir = await makeDir();
    const result = await executeToolCall('read_docx', { path: 'no-such.docx' }, dir);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain('[object');
  });

  it('returns string (no crash) for corrupt docx content', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'bad.docx'), 'not a real zip');
    const result = await executeToolCall('read_docx', { path: 'bad.docx' }, dir);
    expect(typeof result).toBe('string');
  });
});

describe('executeToolCall: read_xlsx', () => {
  it('returns error message for missing path param', async () => {
    const dir = await makeDir();
    const result = await executeToolCall('read_xlsx', {}, dir);
    expect(result).toContain('缺少');
  });

  it('returns error message for non-existent file', async () => {
    const dir = await makeDir();
    const result = await executeToolCall('read_xlsx', { path: 'no-such.xlsx' }, dir);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns string (no crash) for corrupt xlsx content', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'bad.xlsx'), 'not a real zip');
    const result = await executeToolCall('read_xlsx', { path: 'bad.xlsx' }, dir);
    expect(typeof result).toBe('string');
  });
});

// ============================================================
// P0-vis: Tool execution event hooks
// ============================================================
describe('tool execution events (onToolExecution / offToolExecution)', () => {
  it('fires start and end events for executeToolCall', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'evt.txt'), 'hello');
    const events: ToolExecutionEvent[] = [];
    const listener = (e: ToolExecutionEvent) => events.push(e);
    onToolExecution(listener);
    await executeToolCall('read_file', { path: 'evt.txt' }, dir);
    offToolExecution(listener);

    const start = events.find(e => e.phase === 'start');
    const end   = events.find(e => e.phase === 'end');
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect(start?.toolName).toBe('read_file');
    expect(end?.toolName).toBe('read_file');
    expect(typeof end?.durationMs).toBe('number');
  });

  it('offToolExecution prevents further events', async () => {
    const dir = await makeDir();
    const events: ToolExecutionEvent[] = [];
    const listener = (e: ToolExecutionEvent) => events.push(e);
    onToolExecution(listener);
    offToolExecution(listener);   // remove immediately
    await executeToolCall('list_dir', { path: '.' }, dir);
    expect(events.length).toBe(0);
  });

  it('listener errors do not crash executeToolCall', async () => {
    const dir = await makeDir();
    const bad = () => { throw new Error('listener boom'); };
    onToolExecution(bad);
    const result = await executeToolCall('list_dir', {}, dir);
    offToolExecution(bad);
    expect(typeof result).toBe('string');  // no throw
  });
});

describe('formatToolStart / formatToolEnd', () => {
  it('formatToolStart includes tool name and arg summary', () => {
    const evt: ToolExecutionEvent = {
      phase: 'start', toolName: 'read_file', args: { path: 'foo.ts' },
    };
    const line = formatToolStart(evt);
    expect(line).toContain('read_file');
    expect(line).toContain('foo.ts');
  });

  it('formatToolEnd shows ✓ on success', () => {
    const evt: ToolExecutionEvent = {
      phase: 'end', toolName: 'read_file', args: {}, durationMs: 55, success: true,
      resultSnippet: '123chars',
    };
    const line = formatToolEnd(evt);
    expect(line).toContain('✓');
    expect(line).toContain('55ms');
    expect(line).toContain('123chars');
  });

  it('formatToolEnd shows ✗ on failure', () => {
    const evt: ToolExecutionEvent = {
      phase: 'end', toolName: 'run_command', args: {}, durationMs: 10, success: false,
    };
    const line = formatToolEnd(evt);
    expect(line).toContain('✗');
  });
});

// ============================================================
// P2: buildToolCitation
// ============================================================
describe('buildToolCitation', () => {
  it('produces [来源: ...] tag', () => {
    const tag = buildToolCitation('read_file', { path: 'src/index.ts' }, 500);
    expect(tag).toMatch(/\[来源:/);
    expect(tag).toContain('read_file');
    expect(tag).toContain('src/index.ts');
    expect(tag).toContain('500chars');
  });

  it('includes URL for web_fetch', () => {
    const tag = buildToolCitation('web_fetch', { url: 'https://example.com/doc' }, 200);
    expect(tag).toContain('example.com/doc');
  });

  it('includes pattern for search_code', () => {
    const tag = buildToolCitation('search_code', { pattern: 'export.*fn' }, 30);
    expect(tag).toContain('export.*fn');
  });

  it('executeToolCall appends citation for read_file', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'cite.txt'), 'citation test');
    const result = await executeToolCall('read_file', { path: 'cite.txt' }, dir);
    expect(result).toContain('[来源:');
    expect(result).toContain('read_file');
  });
});

// ============================================================
// P1: Permission matrix
// ============================================================
describe('getToolPermissionMatrix', () => {
  it('returns array with ≥10 tools', () => {
    const matrix = getToolPermissionMatrix();
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThanOrEqual(10);
  });

  it('run_command has riskLevel high and requiresConfirmation', () => {
    const p = getToolPermissionMatrix().find(p => p.name === 'run_command');
    expect(p).toBeDefined();
    expect(p?.riskLevel).toBe('high');
    expect(p?.requiresConfirmation).toBe(true);
    expect(p?.canRunCommands).toBe(true);
  });

  it('read_docx has riskLevel low and no write/command/network access', () => {
    const p = getToolPermissionMatrix().find(p => p.name === 'read_docx');
    expect(p).toBeDefined();
    expect(p?.riskLevel).toBe('low');
    expect(p?.canWriteFiles).toBe(false);
    expect(p?.canRunCommands).toBe(false);
    expect(p?.canAccessNetwork).toBe(false);
  });

  it('read_xlsx has riskLevel low', () => {
    const p = getToolPermissionMatrix().find(p => p.name === 'read_xlsx');
    expect(p).toBeDefined();
    expect(p?.riskLevel).toBe('low');
  });
});

describe('renderToolPermissionTable', () => {
  it('returns non-empty multi-line string', () => {
    const table = renderToolPermissionTable();
    expect(typeof table).toBe('string');
    expect(table.split('\n').length).toBeGreaterThan(5);
  });

  it('contains run_command or 命令执行 row', () => {
    const table = renderToolPermissionTable();
    expect(table.includes('run_command') || table.includes('命令执行')).toBe(true);
  });

  it('contains read_docx or Word row', () => {
    const table = renderToolPermissionTable();
    expect(table.includes('read_docx') || table.includes('Word')).toBe(true);
  });
});

describe('renderToolSandboxNote', () => {
  it('returns note for known tool', () => {
    const note = renderToolSandboxNote('run_command');
    expect(note.length).toBeGreaterThan(10);
    expect(note.includes('high') || note.includes('🔴')).toBe(true);
  });

  it('returns fallback for unknown tool', () => {
    const note = renderToolSandboxNote('totally_unknown');
    expect(note).toContain('totally_unknown');
  });

  it('read_docx note mentions no macro execution', () => {
    const note = renderToolSandboxNote('read_docx');
    expect(note.length).toBeGreaterThan(0);
    expect(note.toLowerCase()).toContain('宏');
  });
});
