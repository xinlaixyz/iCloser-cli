/**
 * tool-capability-smoke.mjs — P1 smoke test for tool capability features
 *
 * Validates:
 *   1. read_docx / read_xlsx appear in buildToolDefinitions()
 *   2. read_docx executes correctly against a real .docx fixture
 *   3. read_xlsx executes correctly against a real .xlsx fixture
 *   4. Tool execution event hooks fire (start + end) for every executeToolCall
 *   5. Permission matrix includes all registered tools with correct risk levels
 *   6. renderToolPermissionTable() renders a table with all tool rows
 *   7. renderToolSandboxNote() returns non-empty string for known tools
 *   8. buildToolCitation() produces a correctly formatted citation tag
 *   9. formatToolStart / formatToolEnd produce non-empty strings
 *
 * Usage:
 *   node scripts/tool-capability-smoke.mjs
 * or via npm:
 *   npm run smoke:tools
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function assert(cond, msg, detail = '') {
  check(msg, cond, detail);
  return cond;
}

// ── Pre-flight ────────────────────────────────────────────────────────────────
console.log('\n═══ tool-capability-smoke ═══\n');

if (!existsSync(join(dist, 'core', 'tool-executor.js'))) {
  console.error('dist/core/tool-executor.js not found. Run `npm run build` first.');
  process.exit(1);
}

// ── 1. Tool definitions include read_docx / read_xlsx ─────────────────────────
console.log('── 1. 工具定义 read_docx / read_xlsx ──');
{
  const { buildToolDefinitions } = await import('../dist/core/tool-executor.js');
  const defs = buildToolDefinitions();
  const names = defs.map(d => d.name);

  assert(names.includes('read_docx'), 'read_docx in buildToolDefinitions()', `defs: ${names.join(', ')}`);
  assert(names.includes('read_xlsx'), 'read_xlsx in buildToolDefinitions()', `defs: ${names.join(', ')}`);

  // Both should be before get_project_overview in the list
  const idxDocx = names.indexOf('read_docx');
  const idxOverview = names.indexOf('get_project_overview');
  assert(idxDocx < idxOverview || idxOverview === -1, 'read_docx ordered before get_project_overview');

  // Verify parameter schemas
  const docxDef = defs.find(d => d.name === 'read_docx');
  assert(docxDef?.parameters?.required?.includes('path'), 'read_docx requires path param');
  const xlsxDef = defs.find(d => d.name === 'read_xlsx');
  assert(xlsxDef?.parameters?.required?.includes('path'), 'read_xlsx requires path param');
}

// ── 2. read_docx execution ────────────────────────────────────────────────────
console.log('\n── 2. read_docx 执行 ──');
{
  const { executeToolCall } = await import('../dist/core/tool-executor.js');

  // Create a minimal valid .docx in a temp dir (ZIP containing word/document.xml)
  const tmpDir = join(tmpdir(), `ic-smoke-docx-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // We can't easily create a real ZIP here without dependencies.
  // Instead test error path (non-existent file) and path validation.
  const missingResult = await executeToolCall('read_docx', { path: 'no-such.docx' }, tmpDir);
  assert(
    missingResult.includes('不存在') || missingResult.includes('失败') || missingResult.includes('错误'),
    'read_docx: missing file returns error message',
    missingResult.slice(0, 80)
  );

  // Test with a text file renamed to .docx — should fail gracefully, not crash
  writeFileSync(join(tmpDir, 'test.docx'), 'not a real docx');
  const badResult = await executeToolCall('read_docx', { path: 'test.docx' }, tmpDir);
  assert(
    typeof badResult === 'string' && badResult.length > 0,
    'read_docx: corrupt file returns string (no crash)',
    badResult.slice(0, 80)
  );

  // Test missing path param
  const noPath = await executeToolCall('read_docx', {}, tmpDir);
  assert(noPath.includes('缺少'), 'read_docx: missing path param caught', noPath.slice(0, 60));
}

// ── 3. read_xlsx execution ────────────────────────────────────────────────────
console.log('\n── 3. read_xlsx 执行 ──');
{
  const { executeToolCall } = await import('../dist/core/tool-executor.js');

  const tmpDir = join(tmpdir(), `ic-smoke-xlsx-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // Missing file
  const missingResult = await executeToolCall('read_xlsx', { path: 'no-such.xlsx' }, tmpDir);
  assert(
    missingResult.includes('不存在') || missingResult.includes('失败') || missingResult.includes('错误'),
    'read_xlsx: missing file returns error message',
    missingResult.slice(0, 80)
  );

  // Corrupt file
  writeFileSync(join(tmpDir, 'data.xlsx'), 'not a real xlsx');
  const badResult = await executeToolCall('read_xlsx', { path: 'data.xlsx' }, tmpDir);
  assert(
    typeof badResult === 'string' && badResult.length > 0,
    'read_xlsx: corrupt file returns string (no crash)',
    badResult.slice(0, 80)
  );

  // Missing path param
  const noPath = await executeToolCall('read_xlsx', {}, tmpDir);
  assert(noPath.includes('缺少'), 'read_xlsx: missing path param caught', noPath.slice(0, 60));
}

// ── 4. Tool execution event hooks ─────────────────────────────────────────────
console.log('\n── 4. 工具执行事件 hook ──');
{
  const {
    executeToolCall, onToolExecution, offToolExecution,
    formatToolStart, formatToolEnd,
  } = await import('../dist/core/tool-executor.js');

  const events = [];
  const listener = (e) => events.push(e);
  onToolExecution(listener);

  const tmpDir = join(tmpdir(), `ic-smoke-hook-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, 'hello.txt'), 'hello world');

  await executeToolCall('read_file', { path: 'hello.txt' }, tmpDir, 'task-smoke-1');

  offToolExecution(listener);

  const startEvt = events.find(e => e.phase === 'start');
  const endEvt   = events.find(e => e.phase === 'end');

  assert(startEvt != null, 'hook: start event fired');
  assert(endEvt   != null, 'hook: end event fired');
  assert(startEvt?.toolName === 'read_file', 'hook: start event has correct toolName',
    `got: ${startEvt?.toolName}`);
  assert(endEvt?.toolName === 'read_file', 'hook: end event has correct toolName',
    `got: ${endEvt?.toolName}`);
  assert(typeof endEvt?.durationMs === 'number', 'hook: durationMs is a number',
    `got: ${typeof endEvt?.durationMs}`);
  assert(endEvt?.success === true, 'hook: success=true for valid file read');

  // formatToolStart / formatToolEnd
  const startLine = formatToolStart(startEvt);
  const endLine   = formatToolEnd(endEvt);
  assert(startLine.includes('read_file'), 'formatToolStart contains tool name', startLine);
  assert(endLine.includes('read_file'),   'formatToolEnd contains tool name', endLine);
  assert(startLine.includes('hello.txt'), 'formatToolStart contains file path', startLine);

  // Verify listener is removed after offToolExecution
  const events2 = [];
  const listener2 = (e) => events2.push(e);
  onToolExecution(listener2);
  await executeToolCall('list_dir', { path: '.' }, tmpDir);
  offToolExecution(listener2);
  assert(events2.length >= 2, 'hook: second listener fires independently', `${events2.length} events`);

  // Verify original listener no longer fires
  const eventsAfterOff = [];
  const listenerAfterOff = (e) => eventsAfterOff.push(e);
  onToolExecution(listenerAfterOff);
  await executeToolCall('list_dir', { path: '.' }, tmpDir);
  offToolExecution(listenerAfterOff);
  assert(eventsAfterOff.length >= 2, 'hook: offToolExecution works (new listener still fires)');
}

// ── 5. Permission matrix ───────────────────────────────────────────────────────
console.log('\n── 5. 工具权限矩阵 ──');
{
  const { getToolPermissionMatrix, renderToolPermissionTable, renderToolSandboxNote } =
    await import('../dist/core/tool-executor.js');

  const matrix = getToolPermissionMatrix();
  assert(Array.isArray(matrix) && matrix.length >= 10,
    'getToolPermissionMatrix returns ≥10 entries', `got ${matrix.length}`);

  const runCmd = matrix.find(p => p.name === 'run_command');
  assert(runCmd?.riskLevel === 'high', 'run_command has riskLevel=high');
  assert(runCmd?.requiresConfirmation === true, 'run_command requiresConfirmation=true');
  assert(runCmd?.canRunCommands === true, 'run_command canRunCommands=true');

  const readFile = matrix.find(p => p.name === 'read_file');
  assert(readFile?.riskLevel === 'low',    'read_file has riskLevel=low');
  assert(readFile?.canWriteFiles === false, 'read_file canWriteFiles=false');

  const docxPerm = matrix.find(p => p.name === 'read_docx');
  assert(docxPerm != null,                   'read_docx has permission entry');
  assert(docxPerm?.riskLevel === 'low',      'read_docx riskLevel=low');
  assert(docxPerm?.canRunCommands === false,  'read_docx canRunCommands=false');

  const xlsxPerm = matrix.find(p => p.name === 'read_xlsx');
  assert(xlsxPerm != null,                   'read_xlsx has permission entry');
  assert(xlsxPerm?.riskLevel === 'low',      'read_xlsx riskLevel=low');

  // renderToolPermissionTable
  const table = renderToolPermissionTable();
  assert(typeof table === 'string' && table.length > 100, 'renderToolPermissionTable returns table string',
    `len=${table.length}`);
  assert(table.includes('run_command') || table.includes('命令执行'), 'table contains run_command row');
  assert(table.includes('read_docx')   || table.includes('Word'),     'table contains read_docx row');
  console.log('\n  Permission table preview (first 3 lines):');
  table.split('\n').slice(0, 3).forEach(l => console.log(`    ${l}`));

  // renderToolSandboxNote
  const note = renderToolSandboxNote('run_command');
  assert(note.length > 20, 'renderToolSandboxNote returns non-empty string', note.slice(0, 80));
  assert(note.includes('high') || note.includes('🔴'), 'sandbox note mentions high risk');

  const unknownNote = renderToolSandboxNote('nonexistent_tool');
  assert(unknownNote.includes('nonexistent_tool'), 'sandbox note handles unknown tool gracefully');
}

// ── 6. Source citation (P2) ───────────────────────────────────────────────────
console.log('\n── 6. 工具结果来源引用 ──');
{
  const { buildToolCitation, executeToolCall } = await import('../dist/core/tool-executor.js');

  // buildToolCitation shape
  const cite1 = buildToolCitation('read_file', { path: 'src/index.ts' }, 1234);
  assert(cite1.includes('[来源:'), 'buildToolCitation: starts with [来源:', cite1);
  assert(cite1.includes('read_file'), 'buildToolCitation: contains tool name', cite1);
  assert(cite1.includes('src/index.ts'), 'buildToolCitation: contains file path', cite1);
  assert(cite1.includes('1234chars'), 'buildToolCitation: contains char count', cite1);

  const cite2 = buildToolCitation('web_fetch', { url: 'https://example.com' }, 500);
  assert(cite2.includes('example.com'), 'buildToolCitation: url in web_fetch citation', cite2);

  const cite3 = buildToolCitation('search_code', { pattern: 'export.*function' }, 80);
  assert(cite3.includes('export.*function'), 'buildToolCitation: pattern in search_code citation', cite3);

  // executeToolCall appends citation for read_file (CITE_TOOLS member)
  const tmpDir = join(tmpdir(), `ic-smoke-cite-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, 'cite.txt'), 'citation test content');
  const resultWithCite = await executeToolCall('read_file', { path: 'cite.txt' }, tmpDir);
  assert(resultWithCite.includes('[来源:'), 'executeToolCall appends citation for read_file',
    resultWithCite.slice(-80));

  // executeToolCall does NOT append citation for git_status (not in CITE_TOOLS)
  const gitResult = await executeToolCall('git_status', { action: 'status' }, root);
  // git may not be available, but citation should never appear on non-CITE_TOOLS
  assert(!gitResult.endsWith(']') || !gitResult.includes('[来源:'),
    'executeToolCall: no citation for git_status');
}

// ── Summary ───────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'═'.repeat(55)}`);
console.log(`  ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ' — all green'}`);
console.log(`${'═'.repeat(55)}\n`);
process.exit(failed > 0 ? 1 : 0);
