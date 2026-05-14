// iCloser Agent Shell — Interactive REPL Mode
import * as readline from 'readline';
import * as nodePath from 'path';
import chalk from 'chalk';
import { defaultConfig, loadConfig, saveConfig, saveGlobalConfig } from '../config.js';
import {
  createProvider,
  formatProviderKeyGuidance,
  getAvailableProviders,
  getProviderInfo,
  getProviderStatus,
  inferProviderFromApiKey,
  isLikelyApiKey,
  maskApiKey,
  smokeTestProvider,
} from '../ai/provider.js';
import { parseAIOutput } from '../ai/output-contract.js';
import { recordUserInputEvent } from '../core/memory.js';
import {
  C, I, B,
  welcomeScreen, statusBar, commandHelp,
  drawWideBox, processStep,
  notification, thinDivider, termWidth,
} from './theme.js';
import type { BottomPanelState } from './tui.js';
import type { AIConfig, AIProvider, AIPrompt, ContextPackage, ProjectIdentity, ProjectIndex, Task } from '../types.js';
import type { StreamCallback } from '../ai/provider.js';
import {
  createStartProjectOperation,
  detectPackageManager,
  renderSystemOperationApproval,
  type SystemOperation,
} from './system-approval.js';
import {
  formatCommandChunk,
  isProcessRunning,
  runForegroundCommand,
  startBackgroundCommand,
  stopStartedProcess,
  type StartedProcess,
  type RunnerUi,
} from './system-runner.js';
import { choicePrompt, parseChoiceInput, renderChoicePanel, type ChoicePanel } from './choice-panel.js';
import { isLoopInterventionInput, renderLoopInterventionNotice, renderReplLoopPanel, renderReplLoopStatusBar } from './loop-panel.js';
import { enableOutputSanitizer, printToolDegradationNotice, resetToolDegradationNotices } from './output.js';
import { analyzeProjectAutopilot, planProjectTests, renderAutopilotReport, renderAutopilotTestPlan } from '../core/autopilot.js';
import { buildDocWritePlan, writeDocs, type DocWritePlan } from '../core/autodoc.js';
import { buildTestWritePlan, renderTestWritePlan, writeTests, type TestWritePlan } from '../core/autotest.js';
import { buildExecutionChain, renderExecutionChain } from '../core/execution-chain.js';
import { formatAutopilotVerification, verifyAutopilotDocs, verifyAutopilotTests } from '../core/autopilot-verify.js';
import { routeAutopilotIntent, type AutopilotRoute } from '../core/autopilot-router.js';
import { applyAutopilotRepairPlan, buildAutopilotRepairPlan, renderAutopilotRepairPlan, renderAutopilotRepairReceipts, type AutopilotRepairPlan } from '../core/autopilot-repair.js';
import {
  createAutopilotRollbackPlan,
  renderAutopilotRollbackPlan,
  renderAutopilotRollbackReceipts,
  rollbackAutopilotChanges,
  type AutopilotRollbackPlan,
} from '../core/autopilot-rollback.js';

// ============================================================
// Session State
// ============================================================
interface SessionState {
  projectRoot: string | null;
  sessionId: string;
  conversation: Message[];
  context: {
    projectName: string; language: string; framework: string;
    database: string; buildSystem: string; testFramework: string;
  };
  projectIndex: ProjectIndexSummary | null;
  aiConfig: AIConfig;
  running: boolean;
  pendingFiles: PendingFile[];
  lastWrittenFiles: PendingFile[];
  _retryCount: number;
  _pendingKeyProvider: AIProvider | null;
}

interface ProjectIndexSummary {
  language: string; framework: string; database: string;
  buildSystem: string; testFramework: string;
  moduleCount: number; fileCount: number; apiCount: number;
  modules: { name: string; files: number; responsibility: string }[];
  apis: { method: string; path: string }[];
  dependencies: { name: string; version: string }[];
  architecture: string; fileTree: string;
}

interface Message { role: 'user' | 'assistant' | 'system'; content: string; timestamp: string; }

interface PendingFile { path: string; content: string; lines: number; existed?: boolean; previousContent?: string; fullPath?: string; }

interface PendingAutopilotAction {
  kind: 'docs' | 'tests';
  docPlan?: DocWritePlan;
  testPlan?: TestWritePlan;
}

let outputMode: 'full' | 'brief' = 'full';
let state: SessionState = {
  projectRoot: null, sessionId: `repl-${Date.now().toString(36)}`, conversation: [],
  context: { projectName: '', language: '', framework: '', database: '', buildSystem: '', testFramework: '' },
  projectIndex: null,
  aiConfig: { provider: 'deepseek', model: 'deepseek-v4-pro', apiKey: '', maxTokens: 4096, temperature: 0.7 },
  running: true, pendingFiles: [], lastWrittenFiles: [], _retryCount: 0, _pendingKeyProvider: null,
};

let rl: readline.Interface;
let spinnerIdx = 0;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let abortController: AbortController | null = null;
let streamState: 'idle' | 'loading' | 'streaming' = 'idle';
let streamLineBuf = '';
let waitingStartTime = 0;
let streamTokenCount = 0;
let bottomOptions: { label: string; desc: string; action: string }[] = [];
let mutedInput = false;
let pendingExitSince = 0;
let shuttingDown = false;
const startedProcesses: StartedProcess[] = [];
const systemRunnerUi: RunnerUi = {
  onStart(label) {
    console.log(`  ${C.primary('◇')} ${label}`);
  },
  onOutput(text) {
    printCommandChunk(text);
  },
  onSuccess(message) {
    console.log(`  ${I.ok} ${formatRunnerMessage(message)}\n`);
  },
  onError(message) {
    console.log(`  ${I.err} ${formatRunnerMessage(message)}\n`);
  },
};
let pendingConfirm: 'write' | 'commit' | 'undo' | 'system' | 'autopilot-docs' | 'autopilot-tests' | 'autopilot-repair' | 'autopilot-rollback' | null = null;
let pendingCommitMsg = '';

let pendingSystemOperation: SystemOperation | null = null;
let pendingAutopilotAction: PendingAutopilotAction | null = null;
let pendingAutopilotRepair: AutopilotRepairPlan | null = null;
let pendingAutopilotRollback: AutopilotRollbackPlan | null = null;
let pendingAutopilotRepairAttempt = 0;
const MAX_AUTOPILOT_REPAIR_ATTEMPTS = 2;
let activeChoicePanel: ChoicePanel | null = null;
const approvedSystemOperations = new Set<string>();
const EXAMPLE_PROJECT_PATH = process.platform === 'win32' ? 'D:\\temp\\your-project' : '/home/user/project';

const SLASH_COMMANDS = [
  '/help', '/h', '/?', '/exit', '/quit', '/q', '/clear', '/c',
  '/init', '/i', '/scan', '/s', '/verify', '/v', '/write', '/w',
  '/diff', '/d', '/undo', '/test', '/tt', '/report', '/rp', '/apikey', '/key',
  '/commit', '/config', '/cd', '/pwd', '/start', '/serve', '/stop', '/restart', '/status', '/doctor', '/run', '/agents', '/ag',
  '/global', '/gm', '/memory', '/mem', '/search', '/context', '/ctx', '/intel', '/code',
  '/brief', '/full', '/p', '/orchestrate', '/docs',
];

function box(content: string, title: string): string { return drawWideBox(content, { title }); }

function printStatusLine(): void {
  const ctxTokens = Math.round(state.conversation.reduce((s, m) => s + m.content.length / 2, 0));
  const ctxMax = state.aiConfig.maxTokens || 4096;
  // Context-aware status line
  if (pendingSystemOperation) {
    process.stdout.write(`\n  ${C.warn('⚡')} ${C.accent(pendingSystemOperation.title)} ${C.dim('─ [y] 允许 [n] 拒绝')}\n`);
    return;
  }
  if (streamState !== 'idle') {
    process.stdout.write(`\r  ${C.primary('◉')} AI ${C.dim('执行中... Ctrl+C 中断')}\n`);
    return;
  }
  if (state.pendingFiles.length > 0) {
    const files = state.pendingFiles.map(f => `${C.accent(f.path)}+${f.lines}`).join(' ');
    process.stdout.write(`\n  ${C.success('▸')} ${files} ${C.dim('─ /write 写入 /diff 预览 /clear 取消')}\n`);
    return;
  }
  process.stdout.write(`\n  ${C.dim(`─ /help /scan /diff /clear · ${(ctxTokens/1000).toFixed(1)}K/${(ctxMax/1000).toFixed(0)}K ─`)}\n`);
}

function printBottomBlock(): void { printStatusLine(); }

async function executePanelAction(action: string): Promise<void> {
  switch (action) {
    case 'help': console.log(commandHelp()); break;
    case 'scan': await cmdScan(); break;
    case 'write': await cmdWrite(); break;
    case 'diff': await cmdDiff(); break;
    case 'clear': state.conversation = []; state.pendingFiles = []; console.log(`  ${I.ok} 对话历史已清除\n`); break;
    case 'exit': await shutdownRepl(); break;
    case 'cancel': state.pendingFiles = []; pendingConfirm = null; console.log(`  ${C.dim('已取消')}\n`); break;
    case 'interrupt': if (abortController) abortController.abort(); break;
    case 'system-approve': await handleSystemOperationApprove(); break;
    case 'system-deny': pendingSystemOperation = null; pendingConfirm = null; console.log(`  ${C.dim('已拒绝系统操作')}\n`); break;
    default: break;
  }
}

function refreshPrompt(): void {
  if (!rl) return;
  if (activeChoicePanel) {
    rl.setPrompt(choicePrompt(activeChoicePanel));
    return;
  }
  if (pendingConfirm || state.pendingFiles.length > 0) {
    rl.setPrompt(`${C.accent('选择')} ${C.dim('输入选项后回车')} ${C.accent('>')} `);
    return;
  }
  rl.setPrompt(`${C.accent('◇')}  `);
}

function promptRepl(): void {
  refreshPrompt();
  rl?.prompt();
}

// ============================================================
// Entry
// ============================================================
export async function startRepl(): Promise<void> {
  enableOutputSanitizer();
  await loadGlobalConfig(); await detectProjectContext(); const resumed = await loadSession();
  state.aiConfig.apiKey = resolveApiKeyForProvider(state.aiConfig.provider);
  const offlineReason = enableOfflineModeIfMissingKey();
  console.log(welcomeScreen(state.aiConfig.provider, state.aiConfig.model, state.context.projectName || undefined));
  if (offlineReason) {
    console.log(notification(`${offlineReason.provider.toUpperCase()} API Key 未设置，已切换 mock 离线模式`, 'warn'));
    printProviderKeyHelp(offlineReason.provider);
  }
  resetToolDegradationNotices();
  if (resumed) { console.log(notification(`已恢复上次会话 (${state.conversation.length} 条记录)`, 'info')); }
  if (state.context.projectName) { console.log(''); console.log(statusBar([{ label: 'PROJECT', value: state.context.projectName, color: 'accent' }, { label: 'LANG', value: state.context.language || '—', color: 'primary' }, { label: 'FRAMEWORK', value: state.context.framework || '—', color: 'primary' }, { label: 'AI', value: state.aiConfig.provider.toUpperCase(), color: 'success' }])); }
  printFirstRunGuide(Boolean(offlineReason));
  printBottomBlock();
  // Use readline for proper IME/composition support (raw mode breaks CJK input)
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 1000, completer: replCompleter });
  rl.on('close', () => { void shutdownRepl(); });
  rl.on('SIGINT', () => {
    if (shuttingDown) return;
    if (streamState !== 'idle' && abortController) {
      abortController.abort();
      stopSpinner();
      streamState = 'idle';
      pendingExitSince = 0;
      console.log(`\n  ${C.warn('⚡ 已中断')}`);
      printBottomBlock();
      promptRepl();
      return;
    }
    const now = Date.now();
    if (pendingExitSince > 0 && now - pendingExitSince <= 2000) {
      void shutdownRepl();
      return;
    }
    pendingExitSince = now;
    console.log(chalk.dim('\n  再次 Ctrl+C 或 /exit 退出'));
    promptRepl();
  });
  promptRepl();
  rl.on('line', async (line: string) => {
    pendingExitSince = 0;
    const input = line.trim();
    // During AI execution: block all input — just re-display cursor, no rendering
    if (streamState !== 'idle') { rl?.prompt(); return; }
    // S20.8: history number selection (!1, !2, etc.)
    if (/^!\d+$/.test(input)) {
      const userMsgs = state.conversation.filter(m => m.role === 'user');
      if (userMsgs.length === 0) { console.log(`  ${C.dim('暂无历史')}\n`); promptRepl(); return; }
      const idx = parseInt(input.substring(1), 10);
      if (idx < 1 || idx > userMsgs.length) { console.log(`  ${C.dim(`输入 1-${userMsgs.length}`)}\n`); promptRepl(); return; }
      const histInput = userMsgs[userMsgs.length - idx].content.trim();
      console.log(`  ${C.dim('← ' + histInput.substring(0, 80))}\n`);
      if (histInput.startsWith('/')) await handleSlashCommand(histInput);
      else if (histInput.startsWith('!') && histInput.length > 1) await cmdHistorySearch(histInput.substring(1));
      else await handleChat(histInput);
      printBottomBlock(); if (state.running) promptRepl(); return;
    }
    // Direct single-key shortcuts (no panel lookup)
    if (/^[yhscdwq]$/.test(input) && !activeChoicePanel) {
      if (input === 'y' && pendingSystemOperation) { await handleSystemOperationApprove(); }
      else if (input === 'n' && pendingSystemOperation) { pendingSystemOperation = null; pendingConfirm = null; console.log(`  ${C.dim('已拒绝')}\n`); }
      else if (input === 'h') { console.log(commandHelp()); }
      else if (input === 's') { await cmdScan(); }
      else if (input === 'd') { await cmdDiff(); }
      else if (input === 'c') { state.conversation = []; state.pendingFiles = []; console.log(`  ${I.ok} 对话历史已清除\n`); }
      else if (input === 'w') { await cmdWrite(); }
      else if (input === 'q') { await shutdownRepl(); }
      printBottomBlock(); if (state.running) promptRepl(); return;
    }
    // History search via ! prefix
    if (input.startsWith('!') && input.length > 1) {
      await cmdHistorySearch(input.substring(1));
      printBottomBlock(); if (state.running) promptRepl(); return;
    }
    if (!input) { rl?.prompt(); return; }
    await recordReplUserInput(input);
    if (await handleInlineConfirm(input)) { printBottomBlock(); if (state.running) promptRepl(); return; }
    if (await handleBottomSelection(input)) { printBottomBlock(); if (state.running) promptRepl(); return; }
    if (input.startsWith('/')) { await handleSlashCommand(input); } else { await handleChat(input); }
    printBottomBlock(); if (state.running) promptRepl();
  });
}

async function shutdownRepl(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  state.running = false;
  try {
    for (const proc of startedProcesses.splice(0)) {
      await stopStartedProcess(proc);
    }
    await saveSession();
  } catch {}
  console.log(chalk.dim('\n  iCloser 会话结束\n'));
  process.exit(0);
}

function printFirstRunGuide(offline: boolean): void {
  const lines = offline
    ? [
        `${C.accent('1')}  ${C.bright('粘贴 API Key')} ${C.dim('接入真实模型')}`,
        `${C.accent('2')}  ${C.bright('/apikey')} ${C.dim('安全输入 Key，不显示在屏幕上')}`,
        `${C.accent('3')}  ${C.bright('直接输入需求')} ${C.dim('先用 mock 离线体验')}`,
      ]
    : [
        `${C.accent('1')}  ${C.bright('直接输入需求')} ${C.dim('例如：帮我给登录模块加手机号验证码登录')}`,
        `${C.accent('2')}  ${C.bright('/scan')} ${C.dim('扫描项目')}`,
        `${C.accent('3')}  ${C.bright('/status')} ${C.dim('查看当前状态')}`,
      ];
  console.log('');
  console.log(drawWideBox(lines.join('\n'), { title: offline ? '首次使用' : '下一步' }) + '\n');
}

function clearActiveChoicePanel(): void {
  activeChoicePanel = null;
}

function clearPendingFileConfirmation(): void {
  state.pendingFiles = [];
  if (pendingConfirm === 'write') pendingConfirm = null;
  clearActiveChoicePanel();
}

function clearPendingAutopilotConfirmation(): void {
  pendingAutopilotAction = null;
  pendingAutopilotRepairAttempt = 0;
  if (pendingConfirm === 'autopilot-docs' || pendingConfirm === 'autopilot-tests') pendingConfirm = null;
  clearActiveChoicePanel();
}

function clearPendingAutopilotRepair(): void {
  pendingAutopilotRepair = null;
  pendingAutopilotRepairAttempt = 0;
  if (pendingConfirm === 'autopilot-repair') pendingConfirm = null;
  clearActiveChoicePanel();
}

function clearPendingAutopilotRollback(): void {
  pendingAutopilotRollback = null;
  if (pendingConfirm === 'autopilot-rollback') pendingConfirm = null;
  clearActiveChoicePanel();
}

async function handleInlineConfirm(input: string): Promise<boolean> {
  const key = input.toLowerCase();

  if (pendingConfirm === 'autopilot-repair' && pendingAutopilotRepair) {
    const maxedOut = pendingAutopilotRepairAttempt >= MAX_AUTOPILOT_REPAIR_ATTEMPTS;
    const optionCount = maxedOut ? 2 : 3;
    const selected = parseChoiceInput(key, optionCount);
    if (selected.length === 0) {
      console.log('  ' + C.warn('!') + ` 请在底部输入框输入 1${maxedOut ? ' 或 2' : '、2 或 3'}，然后回车。\n`);
      return true;
    }

    const repair = pendingAutopilotRepair;
    const rollback = pendingAutopilotRollback;
    clearPendingAutopilotRepair();

    if (maxedOut) {
      if (selected[0] === 0 && rollback) {
        pendingAutopilotRepairAttempt = 0;
        const receipts = await rollbackAutopilotChanges(rollback);
        pendingAutopilotRollback = null;
        console.log(drawWideBox(renderAutopilotRollbackReceipts(receipts), { title: '自动回滚结果' }) + '\n');
        return true;
      }
      pendingAutopilotRepairAttempt = 0;
      console.log(drawWideBox('已保留本次写入文件。你可以继续输入”继续修复”，系统会按上面的建议处理。', { title: '保留变更' }) + '\n');
      pendingAutopilotRollback = null;
      return true;
    }

    if (selected[0] === 0) {
      if (!rollback) {
        console.log(drawWideBox('缺少本轮快照，无法安全自动修复。', { title: '自动修复' }) + '\n');
        return true;
      }
      pendingAutopilotRepairAttempt++;
      await executeAutopilotRepairOnce(repair, rollback);
      return true;
    }
    if (selected[0] === 1 && rollback) {
      pendingAutopilotRepairAttempt = 0;
      const receipts = await rollbackAutopilotChanges(rollback);
      pendingAutopilotRollback = null;
      console.log(drawWideBox(renderAutopilotRollbackReceipts(receipts), { title: '自动回滚结果' }) + '\n');
      return true;
    }
    pendingAutopilotRepairAttempt = 0;
    console.log(drawWideBox('已保留本次写入文件。你可以继续输入”继续修复”，系统会按上面的建议处理。', { title: '保留变更' }) + '\n');
    pendingAutopilotRollback = null;
    return true;
  }

  if (pendingConfirm === 'autopilot-rollback' && pendingAutopilotRollback) {
    const selected = parseChoiceInput(key, 3);
    if (selected.length === 0) {
      console.log('  ' + C.warn('!') + ' 请在底部输入框输入 1、2 或 3，然后回车。\n');
      return true;
    }

    const plan = pendingAutopilotRollback;
    clearPendingAutopilotRollback();
    if (selected[0] === 0) {
      const receipts = await rollbackAutopilotChanges(plan);
      console.log(drawWideBox(renderAutopilotRollbackReceipts(receipts), { title: '自动回滚结果' }) + '\n');
      return true;
    }
    if (selected[0] === 1) {
      console.log(drawWideBox('已保留本次写入文件。你可以根据验证失败摘要继续让系统修复。', { title: '保留变更' }) + '\n');
      return true;
    }
    console.log(drawWideBox(renderAutopilotRollbackPlan(plan), { title: '回滚方案' }) + '\n');
    pendingAutopilotRollback = plan;
    pendingConfirm = 'autopilot-rollback';
    printAutopilotRollbackConfirm(plan);
    return true;
  }

  if (pendingConfirm === 'autopilot-docs' && pendingAutopilotAction?.docPlan) {
    const selected = parseChoiceInput(key, 3);
    if (selected.length === 0) {
      console.log(`  ${C.warn('!')} 请在底部输入框输入 1、2 或 3，然后回车。
`);
      return true;
    }

    const plan = pendingAutopilotAction.docPlan;
    clearPendingAutopilotConfirmation();
    if (selected[0] === 0) {
      await executeAutopilotDocsWrite(plan);
      return true;
    }
    if (selected[0] === 1) {
      console.log(drawWideBox(renderDocWritePlanSummary(plan), { title: '文档写入预览' }) + '\n');
      return true;
    }
    console.log(`  ${C.dim('已取消自动文档写入')}
`);
    return true;
  }

  if (pendingConfirm === 'autopilot-tests' && pendingAutopilotAction?.testPlan) {
    const selected = parseChoiceInput(key, 3);
    if (selected.length === 0) {
      console.log(`  ${C.warn('!')} 请在底部输入框输入 1、2 或 3，然后回车。
`);
      return true;
    }

    const plan = pendingAutopilotAction.testPlan;
    clearPendingAutopilotConfirmation();
    if (selected[0] === 0) {
      await executeAutopilotTestsWrite(plan);
      return true;
    }
    if (selected[0] === 1) {
      console.log(drawWideBox(renderTestWritePlan(plan), { title: '测试写入预览' }) + '\n');
      return true;
    }
    console.log(`  ${C.dim('已取消自动测试写入')}
`);
    return true;
  }

  // ═══ Pending slash-command confirmation ═══
  if (pendingConfirm === 'write' && state.pendingFiles.length > 0) {
    if (key === '1') {  pendingConfirm = null; clearActiveChoicePanel(); await cmdWrite([...state.pendingFiles]); return true; }
    if (key === '2') {  pendingConfirm = null; clearActiveChoicePanel(); await cmdDiff(); return true; }
    if (key === '3') {  console.log(`  ${C.dim('已取消')}\n`); pendingConfirm = null; clearActiveChoicePanel(); return true; }
    return false;
  }
  if (pendingConfirm === 'commit') {
    if (key === '1') {  pendingConfirm = null; clearActiveChoicePanel(); await doCommit(pendingCommitMsg); pendingCommitMsg = ''; return true; }
    if (key === '2') {  console.log(`  ${C.dim('已取消提交')}\n`); pendingConfirm = null; clearActiveChoicePanel(); pendingCommitMsg = ''; return true; }
    return false;
  }
  if (pendingConfirm === 'undo') {
    if (key === '1') {  pendingConfirm = null; clearActiveChoicePanel(); await doUndo(); return true; }
    if (key === '2') {  console.log(`  ${C.dim('已取消')}\n`); pendingConfirm = null; clearActiveChoicePanel(); return true; }
    return false;
  }
  if (pendingConfirm === 'system' && pendingSystemOperation) {
    const selected = parseChoiceInput(key, 3);
    if (selected.length === 0) {
      console.log(`  ${C.warn('!')} 请在底部输入框输入 1、2 或 3，然后回车。\n`);
      return true;
    }

    const operation = pendingSystemOperation;
    pendingConfirm = null;
    pendingSystemOperation = null;
    clearActiveChoicePanel();

    if (selected[0] === 0) {
      await executeStartProjectOperation(operation);
      return true;
    }
    if (selected[0] === 1) {
      approvedSystemOperations.add(operation.approvalKey);
      console.log(`  ${I.ok} 本次会话将不再询问同类操作：${C.accent(operation.approvalKey)}\n`);
      await executeStartProjectOperation(operation);
      return true;
    }

    console.log(`  ${C.dim('已取消系统操作')}\n`);
    return true;
  }

  // ═══ File write confirmation (after chat) ═══
  if (state.pendingFiles.length === 0) return false;

  if (key === '1') {  await cmdWrite([...state.pendingFiles]); return true; }
  if (key === '2') {  await cmdDiff(); return true; }
  if (key === '3') {  console.log(`  ${C.dim('已取消')}\n`); state.pendingFiles = []; return true; }
  return false;
}

async function doCommit(msg: string): Promise<void> {
  try { const { execFileSync } = await import('child_process'); const cwd = process.cwd(); const st = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', timeout: 5000 }); if (!st.trim()) { console.log(`  ${C.dim('无变更')}\n`); return; } const message = msg || 'iCloser: 代码修改'; execFileSync('git', ['add', '-A'], { cwd, timeout: 10000 }); execFileSync('git', ['commit', '-m', message], { cwd, timeout: 10000 }); console.log(`  ${I.ok} 已提交\n`); } catch (err) { console.log(`  ${I.err} ${(err as Error).message}\n`); }
}

async function doUndo(): Promise<void> {
  if (state.lastWrittenFiles.length === 0) { console.log(`  ${C.dim('无已写入文件可撤销')}\n`); return; }
  await doUndoFiles();
}

async function handleBottomSelection(input: string): Promise<boolean> {
  if (!input || state.pendingFiles.length === 0) return false;

  if (isAllBottomSelection(input)) {
    
    await cmdWrite([...state.pendingFiles]);
    return true;
  }

  const optionCount = state.pendingFiles.length + 2;
  const selected = parseBottomSelection(input, optionCount);
  if (selected.length === 0) return false;

  

  const writeIndexes = selected.filter(index => index >= 0 && index < state.pendingFiles.length);
  const diffIndex = state.pendingFiles.length;
  const undoIndex = state.pendingFiles.length + 1;

  if (writeIndexes.length > 0) {
    const files = writeIndexes.map(index => state.pendingFiles[index]).filter(Boolean);
    await cmdWrite(files);
  }
  if (selected.includes(diffIndex)) await cmdDiff();
  if (selected.includes(undoIndex)) await cmdUndo();
  if (state.pendingFiles.length > 0) printFooter(true);
  return true;
}

function isAllBottomSelection(input: string): boolean {
  const raw = input.trim().toLowerCase();
  return ['all', 'a', '全部', '全选', '都写', '全部写入', '写入全部'].includes(raw);
}

export function parseBottomSelection(input: string, optionCount: number): number[] {
  return parseChoiceInput(input, optionCount, true);
}

async function cmdApiKey(args: string): Promise<void> {
  if (!args.trim()) {
    await promptApiKeyWizard();
    return;
  }
  await handleDirectApiKeyInput(args);
}

async function promptApiKeyWizard(): Promise<void> {
  const defaultProvider = state._pendingKeyProvider || (state.aiConfig.provider === 'mock' ? 'deepseek' : state.aiConfig.provider);
  console.log(`  ${C.success('API Key 安全输入向导')}`);
  console.log(`  ${C.dim('输入 Key 时不会显示在屏幕上。直接回车会取消。')}\n`);

  const providerInput = (await askReplQuestion(`  Provider [${defaultProvider}]: `)).trim();
  await recordReplUserInput(providerInput || defaultProvider, 'slash-command');
  const provider = providerInput ? providerInput : defaultProvider;
  if (!isAIProviderName(provider)) {
    console.log(`  ${C.warn('!')} 未知 Provider: ${provider}`);
    console.log(`  ${C.dim('可选: mock / claude / deepseek / openai / qwen')}\n`);
    return;
  }

  const apiKey = (await askReplQuestion('  API Key: ', true)).trim();
  await recordReplUserInput(apiKey, 'api-key');
  console.log('');
  if (!apiKey) {
    console.log(`  ${C.dim('已取消 API Key 输入')}\n`);
    return;
  }
  if (!isLikelyApiKey(apiKey)) {
    console.log(`  ${C.warn('!')} 这不像完整 API Key。请检查后重新运行 ${C.accent('/apikey')}\n`);
    return;
  }

  await saveApiKeyToGlobalConfig(provider, apiKey);
}

async function recordReplUserInput(input: string, kind?: import('../types.js').UserInputKind): Promise<void> {
  if (!input) return;
  try {
    await recordUserInputEvent(process.cwd(), input, {
      kind,
      sessionId: state.sessionId,
      command: input.startsWith('/') ? input.split(/\s+/)[0] : undefined,
    });
  } catch {}
}

function askReplQuestion(question: string, hidden = false): Promise<string> {
  return new Promise(resolve => {
    const originalWrite = (rl as unknown as { _writeToOutput?: (text: string) => void })._writeToOutput;
    if (hidden) {
      mutedInput = true;
      (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = function writeMuted(text: string): void {
        if (!mutedInput || text === '\r\n' || text === '\n') {
          process.stdout.write(text);
        }
      };
    }

    rl.question(question, answer => {
      if (hidden) {
        mutedInput = false;
        if (originalWrite) {
          (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = originalWrite;
        }
      }
      resolve(answer);
    });
  });
}

function looksLikeApiKeyCommand(input: string): boolean {
  const [first, second] = input.trim().split(/\s+/);
  return Boolean(first && second && getAvailableProviders().some(provider => provider.name === first) && isLikelyApiKey(second));
}

async function handleDirectApiKeyInput(input: string): Promise<void> {
  const parsed = parseApiKeyInput(input);
  if (!parsed) {
    console.log(`  ${C.warn('!')} 没看懂 API Key。直接粘贴完整 Key，或输入 /apikey deepseek <key>\n`);
    return;
  }

  await saveApiKeyToGlobalConfig(parsed.provider, parsed.key);
}

function parseApiKeyInput(input: string): { provider: AIProvider; key: string } | null {
  const parts = input.trim().split(/\s+/);
  if (parts.length >= 2 && isAIProviderName(parts[0]) && isLikelyApiKey(parts[1])) {
    return { provider: parts[0], key: parts[1] };
  }

  const key = parts[parts.length - 1] || '';
  if (!isLikelyApiKey(key)) return null;

  const provider = state._pendingKeyProvider || inferProviderFromApiKey(key, state.aiConfig.provider);
  return { provider, key };
}

function isAIProviderName(value: string): value is AIProvider {
  return getAvailableProviders().some(provider => provider.name === value);
}

async function saveApiKeyToGlobalConfig(provider: AIProvider, apiKey: string): Promise<void> {
  const info = getProviderInfo(provider);
  state.aiConfig = {
    ...state.aiConfig,
    provider,
    model: state.aiConfig.provider === provider ? state.aiConfig.model : info.defaultModel,
    apiKey,
  };
  state._pendingKeyProvider = null;

  await saveGlobalConfig('ai', {
    provider: state.aiConfig.provider,
    model: state.aiConfig.model,
    apiKey,
    maxTokens: state.aiConfig.maxTokens,
    temperature: state.aiConfig.temperature,
  });

  console.log(`  ${I.ok} API Key 已保存：${C.accent(provider)} ${C.dim(maskApiKey(apiKey))}`);
  console.log(`  ${C.dim('正在测试真实模型连接...')}`);
  const result = await smokeTestProvider(state.aiConfig);
  if (result.ok) {
    console.log(`  ${I.ok} 连接成功，已切换到 ${C.accent(provider)} / ${C.accent(result.model)}\n`);
    console.log(`  ${C.success('下一步直接输入你的需求，例如：')}`);
    console.log(`  ${C.accent('帮我给登录模块加手机号验证码登录')}`);
    console.log(`  ${C.dim('AI 生成文件修改后，输入 y 写入、n 取消、d 预览。')}\n`);
  } else {
    console.log(`  ${C.warn('!')} Key 已保存，但连接测试未通过。你仍可继续使用 mock，稍后运行 ${C.accent('/apikey')} 重新粘贴。\n`);
    if (result.error) console.log(`  ${C.dim(result.error.split('\n')[0])}\n`);
  }
}

function isApiKeyHelpIntent(input: string): boolean {
  const normalized = input.toLowerCase().replace(/\s+/g, '');
  return [
    'apikey',
    'api-key',
    'key',
    '密钥',
    '配置key',
    '设置key',
    '输入key',
    '怎么配置key',
    '我要配置key',
    '配置apikey',
    '设置apikey',
    '输入apikey',
    '怎么配置apikey',
  ].some(keyword => normalized.includes(keyword));
}

// ============================================================
// Slash Commands
// ============================================================
async function handleSlashCommand(input: string): Promise<void> {
  const parts = input.split(/\s+/).filter(Boolean);
  // Fix "/ scan" → "/scan", "/ config provider" → "/config"
  let cmd = parts[0]?.toLowerCase() || '';
  let argStart = 1;
  if (cmd === '/' && parts.length > 1) {
    cmd = '/' + parts[1].toLowerCase();
    argStart = 2;
  }
  const args = parts.slice(argStart).join(' ');
  switch (cmd) {
    case '/help': case '/h': console.log(commandHelp()); break;
    case '/?': case '/p': await cmdCommandPalette(args); break;
    case '/brief': outputMode = 'brief'; console.log(`  ${I.ok} ${C.dim('简洁模式 — 代码块折叠，仅显示关键内容')}\n`); break;
    case '/full': outputMode = 'full'; console.log(`  ${I.ok} ${C.dim('详细模式 — 完整输出')}\n`); break;
    case '/exit': case '/quit': case '/q': await shutdownRepl(); break;
    case '/clear': case '/c': state.conversation = []; state.pendingFiles = []; console.log(`  ${I.ok} 对话历史已清除\n`); break;
    case '/init': case '/i': await cmdInit(); break;
    case '/scan': case '/s': await cmdScan(); break;
    case '/verify': case '/v': await cmdVerify(); break;
    case '/write': case '/w': await cmdWrite(); break;
    case '/diff': case '/d': await cmdDiff(); break;
    case '/undo': await cmdUndo(); break;
    case '/test': case '/tt': await cmdTestGen(); break;
    case '/report': case '/rp': await cmdReport(); break;
    case '/commit': await cmdCommit(args); break;
    case '/apikey': case '/key': await cmdApiKey(args); break;
    case '/cd': await cmdChangeDirectory(args); break;
    case '/pwd': cmdPrintWorkingDirectory(); break;
    case '/start': case '/serve': await cmdStartProject(); break;
    case '/stop': await cmdStopProject(); break;
    case '/restart': await cmdRestartProject(); break;
    case '/config': await cmdConfig(args); break;
    case '/history': case '/hist': cmdHistory(); break;
    case '/status': await cmdReplStatus(); break;
    case '/doctor': await cmdDoctor(); break;
    case '/run': if (args) await cmdRunAgent(args); else console.log(`  ${C.dim('用法: /run <Agent描述>')}\n`); break;
    case '/agents': case '/ag': cmdListAgents(); break;
    case '/orchestrate': if (args) await cmdOrchestrate(args); else console.log(`  ${C.dim('用法: /orchestrate <复杂任务描述>')}\n`); break;
    case '/agent': if (args) await cmdAgentSlash(args); else cmdListAgents(); break;
    case '/global': case '/gm': await cmdGlobalMemory(args); break;
    case '/memory': case '/mem': await cmdMemory(); break;
    case '/search': if (args) await cmdSearch(args); break;
    case '/intel': case '/code': if (args) await cmdIntel(args); else console.log(`  ${C.dim('用法: /intel <函数名 | 文件 | 依赖>')}\n`); break;
    case '/context': case '/ctx': await cmdContext(args); break;
    case '/docs': await cmdDocsSlash(args); break;
    default: console.log(`  ${C.warn('?')} 未知命令: ${cmd}\n`);
    }
    }


function printLoopStatus(_step: import('../core/task-loop.js').TaskLoopStepId, title?: string): void {
  // S20 panel handles all status display — show minimal one-liner
  if (title) console.log(`  ${C.primary('◉')} ${C.dim(title)}`);
}
// ============================================================
// Chat
// ============================================================
async function handleChat(input: string): Promise<void> {
  if (state.pendingFiles.length > 0) {
    clearPendingFileConfirmation();
  }
  if (isCliCommandInRepl(input)) {
    console.log(`  ${C.warn('!')} 你输入的是终端命令，不是对话。`);
    console.log(`  ${C.dim('输入 /exit 退出 REPL，然后在终端直接运行：')} ${C.accent(input)}`);
    console.log(`  ${C.dim('或者用 /cmd ' + input.split(' ').slice(1).join(' '))} ${C.dim('在 REPL 内执行（需确认）')}\n`);
    return;
  }
  if (isLoopInterventionInput(input)) {
    console.log(renderLoopInterventionNotice(input) + '\n');
    printLoopStatus('collect-context', '重新收集上下文');
    return;
  }
  if (isChangeDirectoryIntent(input)) {
    const dir = extractDirectoryPath(input);
    if (dir) await cmdChangeDirectory(dir);
    else cmdPrintWorkingDirectory();
    return;
  }
  if (isCurrentDirectoryQuestion(input)) {
    cmdPrintWorkingDirectory();
    return;
  }
  if (isWrittenFilesQuestion(input)) {
    await cmdPrintLastWrittenFiles();
    return;
  }
  if (isStopProjectIntent(input)) {
    await cmdStopProject();
    return;
  }
  if (isRestartProjectIntent(input)) {
    await cmdRestartProject();
    return;
  }
  if (isStartProjectIntent(input) || (isDoItIntent(input) && hasRecentStartProjectIntent())) {
    printLoopStatus('collect-context', '识别启动需求');
    printLoopStatus('take-action', '准备执行系统命令');
    await cmdStartProject();
    return;
  }
  if (isRunningStatusIntent(input)) {
    cmdRunningStatus();
    return;
  }
  if (isLikelyApiKey(input) || looksLikeApiKeyCommand(input)) {
    await handleDirectApiKeyInput(input);
    return;
  }
  if (isApiKeyHelpIntent(input)) {
    const provider = state._pendingKeyProvider || (state.aiConfig.provider === 'mock' ? 'deepseek' : state.aiConfig.provider);
    printProviderKeyHelp(provider);
    return;
  }
  if (isCodeIntelIntent(input)) {
    const q = extractCodeIntelQuery(input);
    await cmdIntel(q);
    return;
  }
  const autopilotRoute = routeAutopilotIntent(input);
  if (autopilotRoute.intent !== 'none') {
    printLoopStatus('collect-context', '本地工程意图');
    await handleAutopilotRoute(autopilotRoute);
    return;
  }
  state.aiConfig.apiKey = resolveApiKeyForProvider(state.aiConfig.provider);
  // AI intent detection — classify user intent before processing
  let userIntent = '';
  try {
    const { classifyIntentRegex } = await import('../core/intent-classifier.js');
    const intent = classifyIntentRegex(input);
    if (intent && intent.confidence >= 0.8) {
      userIntent = intent.category;
      const intentLabel = intent.category === 'code_change' ? '🔧 代码修改' :
        intent.category === 'analysis' ? '🔍 项目分析' :
        intent.category === 'security_review' ? '🛡️ 安全检查' :
        intent.category === 'refactor' ? '♻️ 重构优化' :
        intent.category === 'test_gen' ? '🧪 测试生成' :
        intent.category === 'doc_gen' ? '📝 文档生成' :
        intent.category === 'question' ? '💡 咨询问答' :
        intent.category === 'config' ? '⚙️ 系统配置' : '';
      if (intentLabel) console.log(`  ${C.dim('意图: ' + intentLabel)}`);
    }
  } catch { /* intent detection is best-effort */ }

  enableOfflineModeIfMissingKey();
  abortController = new AbortController(); const signal = abortController.signal;
  try {
    const history = state.conversation.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
    const richContext = await buildRichContext(input);
    const prompt: AIPrompt = { systemPrompt: buildSystemPrompt(), context: richContext, task: input, history };
    printToolDegradationNotice();
    console.log(`\n  ${C.accent('◇')} ${chalk.bold('You')}  ${input}`);
    state.conversation.push({ role: 'user', content: input, timestamp: new Date().toISOString() });
    streamState = 'loading'; streamLineBuf = ''; startWaitingPhase();
    process.stdout.write(`\r  ${C.primary('◉')} ${chalk.bold('AI')} ${C.dim(`正在连接 ${state.aiConfig.provider.toUpperCase()}...`)}`);
    let fullResponse = ''; let firstChunk = true; let inCodeBlock = false; let codeLang = ''; let suppressCodeBlock = false;
    let codeBlockLines = 0; let codeBlockFolded = false; const FOLD_THRESHOLD = 30; const FOLD_PREVIEW = 5;
    let lineCount = 0;
    const aiStartTime = Date.now(); const tw = Math.min(termWidth(), 100); const contentW = tw - 4;
    const provider = createProvider(state.aiConfig);
    const response = await provider.chatStream(prompt, (chunk: string) => {
      if (signal.aborted) return;
      streamTokenCount += Math.round(chunk.length / 3.5);
      if (firstChunk) { streamState = 'streaming'; streamTokenCount = 0; process.stdout.write('\n'); firstChunk = false; }
      fullResponse += chunk; streamLineBuf += chunk;
      const lines = streamLineBuf.split('\n'); streamLineBuf = lines.pop() || '';
      for (const line of lines) {
        lineCount++;
        if (line.trim().startsWith('``')) {
          if (!inCodeBlock) {
            // Entering code block
            inCodeBlock = true; codeBlockLines = 0; codeBlockFolded = false;
            codeLang = line.trim().slice(3).trim();
            suppressCodeBlock = shouldHideWriteJsonBlock(input, codeLang) || outputMode === 'brief';
            if (!suppressCodeBlock) process.stdout.write(`  ${C.dim(codeLang ? '```' + codeLang : '```')}\n`);
            else if (outputMode === 'brief') process.stdout.write(`  ${C.dim('```')} ${C.accent(codeLang || 'code')} ${C.dim('(简洁模式隐藏)')}\n`);
          } else {
            // Exiting code block
            if (codeBlockFolded) {
              process.stdout.write(`  ${C.dim(`… (${codeBlockLines - FOLD_PREVIEW - 2} 行折叠)`)}\n`);
            }
            if (!suppressCodeBlock) process.stdout.write(`  ${C.dim('```')}\n`);
            inCodeBlock = false; suppressCodeBlock = false;
          }
        } else if (inCodeBlock) {
          if (suppressCodeBlock) continue;
          codeBlockLines++;
          if (codeBlockLines <= FOLD_PREVIEW) {
            process.stdout.write(`  ${C.dim(line)}\n`);
          } else if (codeBlockLines > FOLD_PREVIEW && codeBlockLines <= FOLD_THRESHOLD) {
            process.stdout.write(`  ${C.dim(line)}\n`);
          } else if (codeBlockLines === FOLD_THRESHOLD + 1) {
            codeBlockFolded = true;
            // Don't print — start folding
          } else {
            // Still folding, don't print
          }
        } else { renderMarkdownLine(line, contentW); }
      }
    });
    const elapsed = Date.now() - aiStartTime;
    if (signal.aborted) { stopWaitingPhase(); process.stdout.write(`\n  ${C.warn('⚡ 已中断')}\n\n`); streamState = 'idle'; return; }
    if (streamLineBuf) { renderMarkdownLine(streamLineBuf, contentW); lineCount++; }
    if (inCodeBlock && !suppressCodeBlock) {
      if (codeBlockFolded) process.stdout.write(`  ${C.dim(`… (${codeBlockLines - FOLD_PREVIEW - 2} 行折叠)`)}\n`);
      process.stdout.write(`  ${C.dim('```')}\n`);
    }
    // Clear progress line and show final status
    const tokens = response.tokensUsed > 0 ? response.tokensUsed : streamTokenCount;
    process.stdout.write(`\r\x1b[K  ${C.success('✓')} ${C.dim(`[${(elapsed/1000).toFixed(1)}s]  ${lineCount} 行  ${tokens.toLocaleString()} tokens`)}\n`);
    stopWaitingPhase(); streamState = 'idle'; streamLineBuf = '';
    state.conversation.push({ role: 'assistant', content: fullResponse || response.content, timestamp: new Date().toISOString() });
    let fileBlocks = extractFileBlocks(fullResponse || response.content, input);
    if (fileBlocks.length === 0 && shouldRepairWriteOutput(input, fullResponse || response.content)) {
      fileBlocks = await repairWriteOutput(provider, prompt, fullResponse || response.content);
    }
    // S21: summary-first — show tldr line before full output if response is long
    const respText = fullResponse || response.content;
    const responseLines = respText.split('\n').length;
    if (responseLines > 30) {
      const firstLine = respText.split('\n').find(l => l.trim() && !l.trim().startsWith('```') && l.trim().length > 10) || '';
      console.log(`  ${C.primary('◆')} ${C.dim(firstLine.substring(0, 100))}${firstLine.length > 100 ? '…' : ''}`);
      console.log(`  ${C.dim(`(${responseLines} 行 · 上方滚动查看完整内容)`)}\n`);
    }
    // S21: activity summary
    const mentionedFiles = extractMentionedFiles(respText);
    const codeBlocks = (respText.match(/```/g) || []).length / 2;
    if (fileBlocks.length > 0) {
      console.log(`  ${C.dim('╭─')} ${C.accent('产出')} ${C.dim('─'.repeat(60))}`);
      for (const fb of fileBlocks) {
        const addLine = fb.content.split('\n').length;
        console.log(`  ${C.dim('│')} ${C.success('▸')} ${C.accent(fb.path)} ${C.success(`+${addLine} 行`)}`);
      }
      console.log(`  ${C.dim('╰')}${C.dim('─'.repeat(66))}`);
    } else if (mentionedFiles.length > 0 || codeBlocks > 0) {
      console.log(`  ${C.dim('╭─')} ${C.accent('分析')} ${C.dim('─'.repeat(60))}`);
      if (codeBlocks > 0) console.log(`  ${C.dim('│')} ${C.primary('```')} ${codeBlocks} 个代码示例`);
      if (mentionedFiles.length > 0) console.log(`  ${C.dim('│')} ${C.dim('涉及文件:')} ${mentionedFiles.slice(0, 5).map(f => C.accent(f)).join(', ')}${mentionedFiles.length > 5 ? C.dim(` +${mentionedFiles.length - 5}`) : ''}`);
      console.log(`  ${C.dim('╰')}${C.dim('─'.repeat(66))}`);
    }
    printFooter(fileBlocks.length > 0);
  } catch (err) {
    stopSpinner(); streamState = 'idle'; if (signal.aborted) { abortController = null; return; }
    const msg = (err as Error).message || String(err as Error);
    if ((msg.includes('ECONNREFUSED') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('500') || msg.includes('Premature close') || msg.includes('premature')) && (state._retryCount || 0) < 2) { state._retryCount = (state._retryCount || 0) + 1; console.log(`  ${C.warn('!')} 网络异常，2s 后重试 (${state._retryCount}/2)`); await new Promise(r => setTimeout(r, 2000)); await handleChat(input); return; }
    state._retryCount = 0; console.log(`  ${I.err} ${msg}\n`);
  } finally { abortController = null; }
}

async function handleAutopilotRoute(route: AutopilotRoute): Promise<void> {
  const cwd = process.cwd();
  try {
    if (route.intent === 'report') {
      const report = await analyzeProjectAutopilot(cwd);
      console.log(drawWideBox(renderAutopilotReport(report), { title: '自动项目分析' }) + '\n');
      return;
    }

    if (route.intent === 'tests') {
      const plan = await planProjectTests(cwd);
      console.log(drawWideBox(renderAutopilotTestPlan(plan), { title: '测试缺口分析' }) + '\n');
      return;
    }

    if (route.intent === 'chain') {
      const chain = buildExecutionChain();
      console.log(drawWideBox(renderExecutionChain(chain), { title: '自动执行链' }) + '\n');
      return;
    }

    if (route.intent === 'docs') {
      const report = await analyzeProjectAutopilot(cwd);
      const plan = await buildDocWritePlan(cwd, report);
      pendingAutopilotAction = { kind: 'docs', docPlan: plan };
      pendingConfirm = 'autopilot-docs';
      printAutopilotDocsConfirm(plan);
      return;
    }

    if (route.intent === 'test-write') {
      const testPlan = await planProjectTests(cwd);
      const writePlan = await buildTestWritePlan(cwd, testPlan);
      pendingAutopilotAction = { kind: 'tests', testPlan: writePlan };
      pendingConfirm = 'autopilot-tests';
      printAutopilotTestsConfirm(writePlan);
      return;
    }
  } catch (err) {
    clearPendingAutopilotConfirmation();
    console.log(`  ${I.err} 自动工程处理失败：${(err as Error).message}
`);
  }
}

function printAutopilotDocsConfirm(plan: DocWritePlan): void {
  const writable = plan.docs.filter(doc => !doc.exists);
  activeChoicePanel = {
    title: '自动补齐文档',
    subtitle: `当前目录：${plan.rootPath}`,
    bodyLines: [
      `将写入 docs 目录下缺失文档：${writable.length} 个`,
      ...writable.slice(0, 6).map(doc => `文件 ${doc.file}`),
      ...(writable.length > 6 ? [`还有 ${writable.length - 6} 个文件未显示`] : []),
      ...(writable.length === 0 ? ['没有发现缺失文档，本次不会写入。'] : []),
    ],
    options: [
      { id: 1, label: writable.length > 0 ? '确认写入缺失文档' : '确认检查完成' },
      { id: 2, label: '先预览计划' },
      { id: 3, label: '取消' },
    ],
    hint: '下面输入框只接受选项数字；选择 1 后系统写入并自动校验存在。',
  };
  process.stdout.write(renderChoicePanel(activeChoicePanel));
}

function printAutopilotTestsConfirm(plan: TestWritePlan): void {
  activeChoicePanel = {
    title: '自动补测试',
    subtitle: `当前目录：${plan.rootPath}`,
    bodyLines: [
      `目标模块：${plan.target ? plan.target.module : '暂无缺口'}`,
      `验证命令：${plan.testCommand}`,
      ...plan.tests.map(test => `文件 ${test.file} ← ${test.sourceFile}`),
      ...(plan.tests.length === 0 ? ['没有找到需要自动补测的模块，本次不会写入。'] : []),
    ],
    options: [
      { id: 1, label: plan.tests.length > 0 ? '确认写入最小测试' : '确认检查完成' },
      { id: 2, label: '先预览计划' },
      { id: 3, label: '取消' },
    ],
    hint: '下面输入框只接受选项数字；选择 1 后系统写入一个最小测试并自动验证。',
  };
  process.stdout.write(renderChoicePanel(activeChoicePanel));
}

function renderDocWritePlanSummary(plan: DocWritePlan): string {
  const lines = [
    '安全文档写入计划',
    '',
    `项目路径：${plan.rootPath}`,
    `新建文档：${plan.totalNew} 个`,
    `已存在文档：${plan.totalExisting} 个，默认不会覆盖`,
    '',
    '将写入：',
  ];
  const writable = plan.docs.filter(doc => !doc.exists);
  if (writable.length === 0) lines.push('- 暂无缺失文档。');
  for (const doc of writable) lines.push(`- ${doc.file}`);
  lines.push('', '规则：只写入 docs 目录下缺失文档，写入后校验文件存在、内容非空、包含一级标题。');
  return lines.join('\n');
}

async function executeAutopilotDocsWrite(plan: DocWritePlan): Promise<void> {
  printLoopStatus('take-action', '写入文档');
  const candidateFiles = plan.docs.filter(file => !file.exists).map(file => file.file);
  const rollbackPlan = await createAutopilotRollbackPlan(plan.rootPath, candidateFiles, '文档自动校验失败');
  const written = await writeDocs(plan.rootPath, plan);
  const writtenFiles = written.map(file => file.file);
  printAutopilotWriteReceipts('文档写入', written.map(file => ({ file: file.file, fullPath: file.fullPath, lines: file.lines, bytes: file.bytes, verified: file.verified })));
  printLoopStatus('verify-result', '校验文档');
  const verification = await verifyAutopilotDocs(plan.rootPath, writtenFiles);
  console.log(drawWideBox(formatAutopilotVerification(verification), { title: '自动校验' }) + '\n');
  if (verification.status === 'fail' && written.length > 0) promptAutopilotRepair(verification, writtenFiles, rollbackPlan);
}

async function executeAutopilotTestsWrite(plan: TestWritePlan): Promise<void> {
  printLoopStatus('take-action', '写入测试');
  const candidateFiles = plan.tests.filter(file => !file.exists).map(file => file.file);
  const rollbackPlan = await createAutopilotRollbackPlan(plan.rootPath, candidateFiles, '测试自动校验失败');
  const written = await writeTests(plan.rootPath, plan);
  const writtenFiles = written.map(file => file.file);
  printAutopilotWriteReceipts('测试写入', written.map(file => ({ file: file.file, fullPath: file.fullPath, lines: file.lines, bytes: file.bytes, verified: file.verified })));
  printLoopStatus('verify-result', '校验测试');
  const verification = await verifyAutopilotTests(plan.rootPath, plan.testCommand);
  console.log(drawWideBox(formatAutopilotVerification(verification), { title: '自动校验' }) + '\n');
  if (verification.status === 'fail' && written.length > 0) promptAutopilotRepair(verification, writtenFiles, rollbackPlan);
}

function promptAutopilotRepair(verification: Awaited<ReturnType<typeof verifyAutopilotDocs>> | Awaited<ReturnType<typeof verifyAutopilotTests>>, files: string[], rollbackPlan: AutopilotRollbackPlan): void {
  pendingAutopilotRepair = buildAutopilotRepairPlan(verification, files);
  pendingAutopilotRollback = rollbackPlan;
  pendingConfirm = 'autopilot-repair';
  printAutopilotRepairConfirm(pendingAutopilotRepair);
}

async function executeAutopilotRepairOnce(plan: AutopilotRepairPlan, rollbackPlan: AutopilotRollbackPlan): Promise<void> {
  const receipts = await applyAutopilotRepairPlan(rollbackPlan.rootPath, plan);
  console.log(drawWideBox(renderAutopilotRepairReceipts(receipts), { title: '自动修复结果' }) + '\n');

  const changed = receipts.some(receipt => receipt.ok && receipt.action === 'updated');
  if (!changed) {
    console.log(drawWideBox(renderAutopilotRepairPlan(plan), { title: '自动修复建议' }) + '\n');
    pendingAutopilotRepair = plan;
    pendingAutopilotRollback = rollbackPlan;
    pendingConfirm = 'autopilot-repair';
    printAutopilotRepairConfirm(plan);
    return;
  }

  const verification = plan.kind === 'docs'
    ? await verifyAutopilotDocs(rollbackPlan.rootPath, plan.files)
    : await verifyAutopilotTests(rollbackPlan.rootPath, plan.command || '');
  console.log(drawWideBox(formatAutopilotVerification(verification), { title: '自动复验' }) + '\n');

  if (verification.status === 'fail') {
    pendingAutopilotRepair = buildAutopilotRepairPlan(verification, plan.files);
    pendingAutopilotRollback = rollbackPlan;
    pendingConfirm = 'autopilot-repair';
    printAutopilotRepairConfirm(pendingAutopilotRepair);
    return;
  }

  pendingAutopilotRepair = null;
  pendingAutopilotRollback = null;
  pendingAutopilotRepairAttempt = 0;
}

function printAutopilotRepairConfirm(plan: AutopilotRepairPlan): void {
  const maxedOut = pendingAutopilotRepairAttempt >= MAX_AUTOPILOT_REPAIR_ATTEMPTS;
  activeChoicePanel = {
    title: '验证失败处理',
    subtitle: maxedOut
      ? `已尝试 ${MAX_AUTOPILOT_REPAIR_ATTEMPTS} 次自动修复，建议回滚或保留变更`
      : `第 ${pendingAutopilotRepairAttempt + 1} 次修复尝试（最多 ${MAX_AUTOPILOT_REPAIR_ATTEMPTS} 次）`,
    bodyLines: renderAutopilotRepairPlan(plan).split('\n').slice(0, 10),
    options: maxedOut
      ? [
          { id: 1, label: '回滚本次写入' },
          { id: 2, label: '保留变更，稍后修复' },
        ]
      : [
          { id: 1, label: plan.autoApply ? '自动修复一次' : '查看修复建议' },
          { id: 2, label: '回滚本次写入' },
          { id: 3, label: '保留变更，稍后修复' },
        ],
    hint: '下面输入框只接受选项数字；系统先诊断，再由你选择保留或回滚。',
  };
  process.stdout.write(renderChoicePanel(activeChoicePanel));
}

function printAutopilotRollbackConfirm(plan: AutopilotRollbackPlan): void {
  activeChoicePanel = {
    title: '回滚确认',
    subtitle: '可回滚文件：' + plan.files.length + ' 个',
    bodyLines: renderAutopilotRollbackPlan(plan).split('\n').slice(0, 10),
    options: [
      { id: 1, label: '回滚本次写入' },
      { id: 2, label: '保留变更' },
      { id: 3, label: '查看回滚方案' },
    ],
    hint: '下面输入框只接受选项数字；回滚只处理本轮 autopilot 写入的文件。',
  };
  process.stdout.write(renderChoicePanel(activeChoicePanel));
}

function printAutopilotWriteReceipts(title: string, files: { file: string; fullPath: string; lines: number; bytes: number; verified: boolean }[]): void {
  if (files.length === 0) {
    console.log(drawWideBox('没有新文件需要写入。', { title }) + '\n');
    return;
  }
  const lines = files.map(file => [
    `✓ ${file.file}  +${file.lines} 行`,
    `  路径 ${file.fullPath}`,
    `  磁盘确认：${file.verified ? '存在' : '未确认'}，${file.bytes} 字节`,
  ].join('\n'));
  console.log(drawWideBox(lines.join('\n'), { title }) + '\n');
}

async function cmdConfig(args: string): Promise<void> {
  const trimmed = args.trim();
  if (!trimmed) {
    console.log(drawWideBox(`Provider ${C.accent(state.aiConfig.provider)}\nModel ${C.accent(state.aiConfig.model)}\n工作目录 ${C.accent(process.cwd())}`, { title: 'AI 配置' }) + '\n');
    return;
  }

  if (await looksLikeDirectory(trimmed)) {
    await cmdChangeDirectory(trimmed);
    return;
  }

  const [key, value] = trimmed.split(/\s+/);
  if (key === 'provider') {
    if (!value || !isAIProviderName(value)) {
      console.log(`  ${C.warn('!')} 用法: /config provider mock|claude|deepseek|openai|qwen\n`);
      return;
    }
    state.aiConfig.provider = value;
    state.aiConfig.model = getProviderInfo(state.aiConfig.provider).defaultModel;
    state.aiConfig.apiKey = resolveApiKeyForProvider(state.aiConfig.provider);
    console.log(`  ${I.ok} provider → ${C.accent(value)}\n`);
    return;
  }

  if (key === 'model') {
    if (!value) {
      console.log(`  ${C.warn('!')} 用法: /config model <模型名>\n`);
      return;
    }
    state.aiConfig.model = value;
    console.log(`  ${I.ok} model → ${C.accent(value)}\n`);
    return;
  }

  console.log(`  ${C.warn('!')} 没看懂 /config 参数。`);
  console.log(`  ${C.dim('常用：/config  查看配置；/config provider mock；/config model <模型名>')}`);
  console.log(`  ${C.dim(`切换工作目录请用：/cd ${EXAMPLE_PROJECT_PATH}`)}\n`);
}

async function cmdChangeDirectory(target: string): Promise<void> {
  const dir = target.trim().replace(/^["']|["']$/g, '');
  if (!dir) {
    cmdPrintWorkingDirectory();
    console.log(`  ${C.dim(`切换目录：/cd ${EXAMPLE_PROJECT_PATH}`)}\n`);
    return;
  }

  try {
    const path = await import('path');
    const resolved = path.resolve(process.cwd(), dir);
    const fsp = await import('fs/promises');
    const stat = await fsp.stat(resolved);
    if (!stat.isDirectory()) {
      console.log(`  ${C.warn('!')} 不是目录：${C.accent(resolved)}\n`);
      return;
    }

    process.chdir(resolved);
    state.pendingFiles = [];
    state.lastWrittenFiles = [];
    state.projectIndex = null;
    await detectProjectContext();
    console.log(`  ${I.ok} 工作目录已切换`);
    console.log(`  ${C.accent(process.cwd())}\n`);
  } catch {
    console.log(`  ${C.warn('!')} 目录不存在或无法进入：${C.accent(dir)}\n`);
  }
}

function cmdPrintWorkingDirectory(): void {
  console.log(drawWideBox(`当前工作目录\n${C.accent(process.cwd())}`, { title: '工作目录' }) + '\n');
}

async function looksLikeDirectory(value: string): Promise<boolean> {
  if (!value || /\s/.test(value.trim())) return false;
  if (value === 'provider' || value === 'model') return false;
  try {
    const path = await import('path');
    const fsp = await import('fs/promises');
    const resolved = path.resolve(process.cwd(), value.replace(/^["']|["']$/g, ''));
    return (await fsp.stat(resolved)).isDirectory();
  } catch {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('./') || value.startsWith('../');
  }
}

function isCliCommandInRepl(input: string): boolean {
  return /^(ic|iCloser)\s+\w+/i.test(input.trim());
}

function isCurrentDirectoryQuestion(input: string): boolean {
  return /(现在|当前)?(工作目录|当前目录|路径|cwd)(在哪里|是哪|是什么|多少|呢)?[？?]?$/i.test(input.trim());
}

function isChangeDirectoryIntent(input: string): boolean {
  const t = input.trim();
  // "工作目录改为D:\temp" "切换目录到D:\temp" "cd D:\temp"
  return /(工作目录|当前目录|目录|路径|cwd)\s*(改为|切换到|切换为|换到|换为|改成|变为)\s*\S/.test(t) ||
    /^(切换目录|切换工作目录|换目录|进入目录|打开目录)\s+\S/.test(t);
}

function extractDirectoryPath(input: string): string | null {
  // Extract path after change keywords
  const m = input.match(/(?:改为|切换到|切换为|换到|换为|改成|变为|切换目录|切换工作目录|换目录|进入目录|打开目录)\s+(.+?)$/i);
  if (m) return m[1].trim();
  return null;
}

function isWrittenFilesQuestion(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return /(刚才|最近|上次|文档|文件).*(写到哪里|保存到哪里|放到哪里|在哪里|路径)/.test(normalized) ||
    /(写到哪里|保存到哪里|文件路径|文档路径)/.test(normalized);
}

// S2: Scan subdirectories (depth 2) for project indicators
async function scanForSubProjects(
  cwd: string, fsp: any, path: any
): Promise<{ type: string; command: string; args: string[]; label: string; needsInstall: boolean; cwd: string; dir: string }[]> {
  const results: { type: string; command: string; args: string[]; label: string; needsInstall: boolean; cwd: string; dir: string }[] = [];
  try {
    const entries = await fsp.readdir(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const subDir = path.join(cwd, entry.name);
      const info = await detectProjectStartInfo(subDir, fsp, path);
      if (info) results.push({ ...info, cwd: subDir, dir: entry.name });
    }
  } catch {}
  return results;
}

async function detectProjectStartInfo(
  dir: string, fsp: any, path: any
): Promise<{ type: string; command: string; args: string[]; label: string; needsInstall: boolean } | null> {
  // 1. npm/Node.js
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf-8'));
    const scripts = pkg.scripts || {};
    const scriptName = ['dev', 'start', 'serve', 'preview'].find((n: string) => scripts[n]);
    if (scriptName) {
      const pm = await detectPackageManager(dir);
      const nmMissing = !(await fsp.stat(path.join(dir, 'node_modules')).catch(() => null));
      const hasDeps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length > 0;
      const cmd = pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm' : 'npm';
      return { type: `Node.js (${pm})`, command: cmd, args: ['run', scriptName], label: `${cmd} run ${scriptName}`, needsInstall: nmMissing && hasDeps };
    }
  } catch {}

  // 2. Java/Maven
  try {
    const pom = await fsp.readFile(path.join(dir, 'pom.xml'), 'utf-8').catch(() => null);
    const mvnw = await fsp.stat(path.join(dir, 'mvnw.cmd')).catch(() => null)
      || await fsp.stat(path.join(dir, 'mvnw')).catch(() => null);
    if (pom) {
      const cmd = mvnw ? (process.platform === 'win32' ? 'mvnw.cmd' : './mvnw') : 'mvn';
      return { type: 'Spring Boot (Maven)', command: cmd, args: ['spring-boot:run'], label: `${cmd} spring-boot:run`, needsInstall: false };
    }
  } catch {}

  // 3. Java/Gradle
  try {
    const gradle = await fsp.stat(path.join(dir, 'build.gradle')).catch(() => null)
      || await fsp.stat(path.join(dir, 'build.gradle.kts')).catch(() => null);
    const gradlew = await fsp.stat(path.join(dir, 'gradlew')).catch(() => null);
    if (gradle) {
      const cmd = gradlew ? (process.platform === 'win32' ? 'gradlew.bat' : './gradlew') : 'gradle';
      return { type: 'Java (Gradle)', command: cmd, args: ['bootRun'], label: `${cmd} bootRun`, needsInstall: false };
    }
  } catch {}

  // 4. Go
  try {
    const goMod = await fsp.readFile(path.join(dir, 'go.mod'), 'utf-8').catch(() => null);
    const hasMain = await fsp.readFile(path.join(dir, 'main.go'), 'utf-8').catch(() => null);
    if (goMod && hasMain) {
      const mf = await fsp.readFile(path.join(dir, 'Makefile'), 'utf-8').catch(() => null);
      return mf ? { type: 'Go (Makefile)', command: 'make', args: ['run'], label: 'make run', needsInstall: false }
        : { type: 'Go', command: 'go', args: ['run', '.'], label: 'go run .', needsInstall: false };
    }
  } catch {}

  // 5. Python
  try {
    const pyproject = await fsp.readFile(path.join(dir, 'pyproject.toml'), 'utf-8').catch(() => null);
    const mainPy = await fsp.readFile(path.join(dir, 'main.py'), 'utf-8').catch(() => null)
      || await fsp.readFile(path.join(dir, 'app.py'), 'utf-8').catch(() => null);
    if (pyproject || mainPy) {
      return { type: 'Python (FastAPI)', command: process.platform === 'win32' ? 'python' : 'python3',
        args: [mainPy ? 'main.py' : 'app.py'], label: `python ${mainPy ? 'main.py' : 'app.py'}`, needsInstall: false };
    }
  } catch {}

  // 6. Rust
  try {
    const cargoToml = await fsp.readFile(path.join(dir, 'Cargo.toml'), 'utf-8').catch(() => null);
    if (cargoToml) return { type: 'Rust', command: 'cargo', args: ['run'], label: 'cargo run', needsInstall: false };
  } catch {}

  // 7. Docker Compose
  try {
    const dc = await fsp.readFile(path.join(dir, 'docker-compose.yml'), 'utf-8').catch(() => null)
      || await fsp.readFile(path.join(dir, 'docker-compose.yaml'), 'utf-8').catch(() => null);
    if (dc) return { type: 'Docker Compose', command: 'docker-compose', args: ['up'], label: 'docker-compose up', needsInstall: false };
  } catch {}

  // 8. Makefile-only
  try {
    const mf = await fsp.readFile(path.join(dir, 'Makefile'), 'utf-8').catch(() => null);
    if (mf) return { type: 'Makefile', command: 'make', args: [], label: 'make', needsInstall: false };
  } catch {}

  return null;
}

function isStartProjectIntent(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '');
  // Exclude questions — "怎么启动" / "如何启动" is asking HOW, not commanding
  const isQuestion = /^(怎么|如何|怎样|你知道|请问|谁能|谁知道|啥是|什么是|为什么)/i.test(normalized) ||
    /(怎么启动|如何启动|怎样启动|怎么运行|如何运行|怎么跑|如何跑)/i.test(normalized);
  if (isQuestion) return false;
  return /(启动|运行|跑起来|打开|起服务|启动服务|运行项目|启动项目|跑项目|start|serve|npmrundev)/i.test(normalized) &&
    /(项目|服务|前端|后端|vite|react|app|应用|dev|serve|start)/i.test(normalized);
}

function isDoItIntent(input: string): boolean {
  return /^(你来处理|直接处理|帮我处理|你执行|直接执行|开始吧|处理吧|搞定它|来吧)[。！!？?]*$/i.test(input.trim());
}

function hasRecentStartProjectIntent(): boolean {
  return state.conversation.slice(-4).some(message => message.role === 'user' && isStartProjectIntent(message.content));
}

function isStopProjectIntent(input: string): boolean {
  return /(停止|停掉|停下|关掉|关闭|结束|终止|kill|stop)\s*(运行|后台|正在)?\s*(项目|进程|服务|server|dev|开发服)/i.test(input.trim());
}

function isRestartProjectIntent(input: string): boolean {
  return /(重启|重新启动|重新运行|重跑|restart)\s*(项目|服务|server|dev)/i.test(input.trim());
}

function isRunningStatusIntent(input: string): boolean {
  return /(项目|服务|进程)\s*(在|正在)?\s*(运行|跑|启动|活着|active)\s*(吗|呢|没|状态|情况)?[？?]?$/i.test(input.trim()) ||
    /(查看|看看|显示)\s*(运行|后台|启动)\s*(状态|项目|进程|服务)/i.test(input.trim()) ||
    /(哪些|什么|几个)\s*(项目|服务|进程)\s*(在|正在)\s*(跑|运行)/i.test(input.trim());
}

function isCodeIntelIntent(input: string): boolean {
  const t = input.trim();
  return /^(谁|哪里|什么|哪个).*(调用|定义|导出|依赖|引用)/.test(t) ||
    /(函数|符号|变量|模块|文件).*(在哪|是谁|什么|怎么).*(调用|定义|导出|依赖)/.test(t) ||
    /^(查看|显示|列出).*(函数|符号|导出|依赖|调用).*/.test(t) ||
    /^\/intel\b/.test(t) ||
    /^\/code\b/.test(t);
}

function extractCodeIntelQuery(input: string): string {
  // Remove command prefixes
  let q = input.replace(/^\/intel\s*/i, '').replace(/^\/code\s*/i, '').trim();
  // Remove question words that don't add value
  q = q.replace(/^(请问|我想知道|帮我查一下|帮我看看|查看|显示|列出)\s*/i, '');
  return q || input.trim();
}

// ============================================================
// Command Implementations
// ============================================================
async function cmdInit(): Promise<void> {
  process.stdout.write(`  ${C.primary('◇')} 扫描中 `);
  try {
    const { detectProject } = await import('../utils/detect.js'); const identity = await detectProject(process.cwd());
    const cwd = process.cwd();
    applyProjectIdentity(cwd, identity);
    state.aiConfig.temperature = 0.3;

    const config = defaultConfig(cwd, identity);
    await saveConfig(config);

    try {
      const { scanProject, saveProjectIndex } = await import('../core/scanner.js');
      const result = await scanProject({ rootPath: cwd, deep: true, includeTests: true, maxFileSize: 500 * 1024 });
      await saveProjectIndex(cwd, result.index);
      state.projectIndex = summarizeProjectIndex(result.index);
    } catch {
      state.projectIndex = await buildProjectIndex(cwd, identity);
    }

    process.stdout.write('\r\x1b[K'); console.log(`  ${I.ok} 项目已就绪\n`);
    const idx = state.projectIndex;
    console.log(drawWideBox(`名称    ${C.accent(state.context.projectName)}\n语言    ${C.accent(identity.language)}\n框架    ${identity.framework !== 'unknown' ? C.accent(identity.framework) : C.dim('—')}\n数据库  ${identity.database !== 'unknown' ? C.accent(identity.database) : C.dim('—')}\n构建    ${identity.buildSystem !== 'unknown' ? C.accent(identity.buildSystem) : C.dim('—')}\n测试    ${identity.testFramework !== 'unknown' ? C.accent(identity.testFramework) : C.dim('—')}\n文件    ${C.accent(String(idx?.fileCount || '?'))} 个  │  ${C.accent(String(idx?.moduleCount || '?'))} 模块`, { title: '项目识别', color: C.primary }) + '\n');
    if (idx && idx.modules.length > 0) { console.log(`  ${C.dim('模块概览:')}`); for (const m of idx.modules.slice(0, 8)) { console.log(`    ${C.primary('▸')} ${C.accent(m.name)} ${C.dim('(' + m.files + ' 文件)')}`); } console.log(''); }
  } catch { state.projectRoot = process.cwd(); state.context.projectName = process.cwd().split(/[/\\]/).pop() || ''; console.log(`\r\x1b[K  ${I.ok} 工作目录: ${C.accent(state.context.projectName)}\n`); }
}

function applyProjectIdentity(cwd: string, identity: ProjectIdentity): void {
  state.projectRoot = cwd;
  state.context.projectName = cwd.split(/[/\\]/).pop() || '';
  state.context.language = identity.language;
  state.context.framework = identity.framework;
  state.context.database = identity.database;
  state.context.buildSystem = identity.buildSystem;
  state.context.testFramework = identity.testFramework;
}

function summarizeProjectIndex(index: ProjectIndex): ProjectIndexSummary {
  const fileCount = index.modules.reduce((total, mod) => total + mod.files.length, 0);
  return {
    language: index.identity.language,
    framework: index.identity.framework,
    database: index.identity.database,
    buildSystem: index.identity.buildSystem,
    testFramework: index.identity.testFramework,
    moduleCount: index.modules.length,
    fileCount,
    apiCount: index.apis.length,
    modules: index.modules.map(mod => ({ name: mod.name, files: mod.files.length, responsibility: mod.responsibility })),
    apis: index.apis.map(api => ({ method: api.method, path: api.path })),
    dependencies: index.dependencies.map(dep => ({ name: dep.name, version: dep.version })),
    architecture: index.architecturePattern,
    fileTree: index.modules.map(mod => mod.path || mod.name).slice(0, 30).join('\n'),
  };
}

async function buildProjectIndex(cwd: string, identity: { language: string; framework: string; database: string; buildSystem: string; testFramework: string }): Promise<ProjectIndexSummary> {
  const { readdir } = await import('fs/promises'); const { join, relative } = await import('path');
  let fileCount = 0; const modules = new Map<string, number>(); let apiCount = 0;
  async function walk(dir: string, depth: number) { if (depth > 5) return; try { const entries = await readdir(dir, { withFileTypes: true }); for (const e of entries) { if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue; if (e.isDirectory()) await walk(join(dir, e.name), depth + 1); else { fileCount++; const rel = relative(cwd, join(dir, e.name)); const modName = rel.split(/[/\\]/)[0]; modules.set(modName, (modules.get(modName) || 0) + 1); if (rel.includes('route') || rel.includes('handler') || rel.includes('api')) apiCount++; } } } catch {} }
  await walk(cwd, 0); const mdNames = Array.from(modules.keys());
  const arch = mdNames.some(m => m === 'src') ? '模块化' : mdNames.length > 10 ? '多模块' : '单体';
  const deps: { name: string; version: string }[] = [];
  try { const pkgRaw = await (await import('fs/promises')).readFile(join(cwd, 'package.json'), 'utf-8'); const pkg = JSON.parse(pkgRaw); for (const [k, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>)) deps.push({ name: k, version: v }); } catch {}
  let fileTree = ''; try { const ents = await readdir(cwd); for (const e of ents.slice(0, 30)) { if (e.startsWith('.') || e === 'node_modules') continue; fileTree += `${e}\n`; } } catch {}
  return { language: identity.language, framework: identity.framework, database: identity.database, buildSystem: identity.buildSystem, testFramework: identity.testFramework, moduleCount: modules.size, fileCount, apiCount, modules: Array.from(modules.entries()).map(([name, files]) => ({ name, files, responsibility: '' })), apis: [], dependencies: deps.slice(0, 20), architecture: arch, fileTree };
}

async function cmdScan(): Promise<void> {
  process.stdout.write(`  ${C.primary('◇')} 扫描中 `);
  try {
    const { readdir } = await import('fs/promises');
    const { join } = await import('path');
    const { detectProject } = await import('../utils/detect.js');
    const { scanProject, saveProjectIndex } = await import('../core/scanner.js');
    const cwd = process.cwd();
    const identity = await detectProject(cwd);
    applyProjectIdentity(cwd, identity);

    const config = await loadConfig(cwd);
    if (config) {
      config.project.identity = identity;
      await saveConfig(config);
    }

    const result = await scanProject({ rootPath: cwd, deep: true, includeTests: true, maxFileSize: 500 * 1024 });
    await saveProjectIndex(cwd, result.index);
    state.projectIndex = summarizeProjectIndex(result.index);

    let fc = 0; const byExt: Record<string, number> = {};
    async function w(dir: string) { try { const es = await readdir(dir, { withFileTypes: true }); for (const e of es) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; if (e.isDirectory()) await w(join(dir, e.name)); else { fc++; const ext = e.name.split('.').pop() || 'o'; byExt[ext] = (byExt[ext] || 0) + 1; } } } catch {} }
    await w(cwd);

    process.stdout.write('\r\x1b[K'); const top = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 8); console.log(drawWideBox(`文件总数  ${C.accent(String(fc))}\n分布      ${top.map(([k, v]) => C.primary('.' + k) + C.dim(' ×' + v)).join('  ')}`, { title: '项目扫描' }) + '\n');
  } catch { process.stdout.write('\r\x1b[K'); console.log(`  ${I.err} 扫描失败\n`); }
}

async function cmdVerify(): Promise<void> {
  process.stdout.write(`  ${C.primary('◇')} 验证中 `);
  try { const { execFileSync } = await import('child_process'); const cwd = process.cwd(); const lang = state.context.language; const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'; let cmd = npmCmd; let args = ['run', 'build']; if (lang === 'go') { cmd = 'go'; args = ['vet', './...']; } try { const out = execFileSync(cmd, args, { cwd, timeout: 60000, encoding: 'utf-8', stdio: 'pipe' }); process.stdout.write('\r\x1b[K'); console.log(`  ${I.ok} 验证通过\n`); } catch (err) { process.stdout.write('\r\x1b[K'); const e = err as { stdout?: string; stderr?: string }; console.log(`  ${I.err} 验证失败\n`); } } catch { process.stdout.write('\r\x1b[K'); console.log(`  ${I.err} 无法运行\n`); }
}

async function cmdStopProject(): Promise<void> {
  const cwd = process.cwd();
  const running = startedProcesses.filter(proc => isProcessRunning(proc));
  const mine = running.filter(proc => proc.cwd === cwd);
  const title = '停止项目';

  if (running.length === 0) {
    console.log(drawWideBox(`当前没有正在运行的项目或服务。\n目录 ${C.accent(cwd)}`, { title }) + '\n');
    return;
  }

  if (mine.length === 0) {
    const otherList = running.map(p => `${C.accent(p.label)} ${C.dim(`(${p.cwd})`)}`).join('\n');
    console.log(drawWideBox(`当前目录没有运行中的项目。\n\n其他目录的运行中进程：\n${otherList}\n\n如需停止，请切换到对应目录后再说一次${C.accent('停止项目')}`, { title }) + '\n');
    return;
  }

  console.log(`  ${C.primary('◇')} 正在停止 ${mine.length} 个进程...`);
  let stopped = 0;
  for (const proc of mine) {
    await stopStartedProcess(proc);
    stopped++;
  }
  console.log(`  ${I.ok} 已停止 ${C.accent(String(stopped))} 个进程\n`);
}

async function cmdRestartProject(): Promise<void> {
  const cwd = process.cwd();
  const running = startedProcesses.filter(proc => isProcessRunning(proc));
  const mine = running.filter(proc => proc.cwd === cwd);

  if (mine.length > 0) {
    console.log(`  ${C.primary('◇')} 正在停止当前项目...`);
    for (const proc of mine) {
      await stopStartedProcess(proc);
    }
    console.log(`  ${I.ok} 已停止，准备重新启动\n`);
  }

  await cmdStartProject();
}

function cmdRunningStatus(): void {
  const cwd = process.cwd();
  const running = startedProcesses.filter(proc => isProcessRunning(proc));
  const mine = running.filter(proc => proc.cwd === cwd);

  if (running.length === 0) {
    console.log(drawWideBox(`当前没有任何运行中的项目或服务。\n工作目录 ${C.accent(cwd)}\n\n输入 ${C.accent('启动项目')} 启动开发服务。`, { title: '运行状态' }) + '\n');
    return;
  }

  const lines = running.map((proc, i) => {
    const here = proc.cwd === cwd ? C.success(' ← 当前') : '';
    return [
      `${C.accent(`[${i + 1}]`)} ${proc.label}`,
      `${C.dim('目录')} ${proc.cwd}${here}`,
      proc.url ? `${C.dim('地址')} ${C.accent(proc.url)}` : '',
    ].filter(Boolean).join('\n');
  });

  const summary = running.length === 1 ? '1 个服务正在运行' : `${running.length} 个服务正在运行`;
  console.log(drawWideBox(`${C.bright(summary)}\n\n${lines.join('\n\n')}\n\n输入 ${C.accent('停止项目')} 停止当前目录的服务。`, { title: '运行状态' }) + '\n');
}

async function cmdStartProject(): Promise<void> {
  printLoopStatus('take-action', '启动项目');
  const cwd = process.cwd();
  const existing = startedProcesses.find(proc => proc.cwd === cwd && isProcessRunning(proc));
  if (existing) {
    console.log(drawWideBox(`项目已经在运行\n${existing.url ? `地址 ${C.accent(existing.url)}\n` : ''}目录 ${C.accent(cwd)}\n\n输入 ${C.accent('停止项目')} 先停止\n输入 ${C.accent('重启项目')} 停止后重新启动`, { title: '启动项目' }) + '\n');
    return;
  }

  try {
    const fsp = await import('fs/promises');
    const path = await import('path');

    // S2: Scan for subdirectory projects (monorepo support)
    const projects = await scanForSubProjects(cwd, fsp, path);

    // If multiple sub-projects found, list them and start all
    if (projects.length > 1) {
      printLoopStatus('take-action', '多服务启动');
      console.log(drawWideBox(
        `发现 ${projects.length} 个可启动服务:\n${projects.map(p => `  ${C.accent(p.dir)} — ${C.accent(p.type)} → ${p.label}`).join('\n')}\n\n输入 ${C.accent('1')} 全部启动  ${C.accent('2')} 选择启动  ${C.accent('3')} 取消`,
        { title: '多服务发现' }
      ) + '\n');

      pendingSystemOperation = {
        title: '启动全部服务',
        reason: `启动 ${projects.length} 个服务: ${projects.map(p => p.dir).join(', ')}`,
        impact: `共 ${projects.length} 个进程`,
        cwd,
        approvalKey: `start:all:${projects.map(p => p.dir).join(',')}`,
        steps: projects.flatMap(p => [
          ...(p.needsInstall ? [{ label: `${p.dir}: install`, command: p.command, args: ['install'], display: `${p.dir}: ${p.command} install` }] : []),
          { label: `${p.dir}: ${p.label}`, command: p.command, args: p.args, display: `${p.dir}: ${p.label}`, background: true, cwd: p.cwd },
        ]),
      };
      pendingConfirm = 'system';
      printSystemOperationConfirm(pendingSystemOperation);
      return;
    }

    // Single project or no sub-projects found — check root
    let startInfo: { type: string; command: string; args: string[]; label: string; needsInstall: boolean; cwd: string } | null = null;
    if (projects.length === 1) {
      startInfo = projects[0];
    } else {
      // No sub-projects — try root directory
      const rootInfo = await detectProjectStartInfo(cwd, fsp, path);
      if (rootInfo) startInfo = { ...rootInfo, cwd };
    }

    if (!startInfo) {
      // AI fallback: read project files and ask AI for startup instructions
      try {
        const { createProvider } = await import('../ai/provider.js');
        if (state.aiConfig.provider !== 'mock') {
          printLoopStatus('take-action', 'AI 启动分析');
          const ai = createProvider(state.aiConfig);
          const readme = await fsp.readFile(path.join(cwd, 'README.md'), 'utf-8').catch(() => '');
          const devDoc = await fsp.readFile(path.join(cwd, 'DEVELOPMENT.md'), 'utf-8').catch(() => '');
          const dirList = (await fsp.readdir(cwd, { withFileTypes: true }))
            .filter(e => !e.name.startsWith('.') && !e.name.startsWith('node_'))
            .map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).slice(0, 20).join(', ');
          const resp = await ai.chat({
            systemPrompt: '你是启动专家。分析项目结构后输出JSON: {"command":"完整启动命令","reasoning":"理由","install":"安装命令(可选)"}',
            task: `目录: ${cwd}\n内容: ${dirList}\n${readme ? 'README: ' + readme.slice(0, 1500) : ''}`,
            context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
          });
          try {
            const j = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
            console.log(drawWideBox(
              `🤖 AI 启动建议\n${C.accent(cwd)}\n\n${C.accent(j.command || '未知')}\n\n${j.reasoning || ''}${j.install ? '\n\n📦 ' + j.install : ''}`,
              { title: 'AI 启动顾问' }
            ) + '\n');
          } catch { console.log(drawWideBox(resp.content.slice(0, 600), { title: 'AI 启动建议' }) + '\n'); }
          return;
        }
      } catch { /* AI fallback failed, show static help */ }
      console.log(drawWideBox(`未找到可启动配置\n${C.accent(cwd)}\n\n支持的启动方式: npm/go/python/rust/maven/docker\n\n找不到时 AI 会自动分析项目给出建议`, { title: '启动项目' }) + '\n');
      return;
    }

    // Show what we found and how we'll start
    printLoopStatus('take-action', '启动项目');
    console.log(drawWideBox(
      `检测到 ${C.accent(startInfo.type)} 项目\n${C.accent(cwd)}\n\n启动命令: ${C.accent(startInfo.label)}${startInfo.needsInstall ? '\n\n⚠ 需要先安装依赖' : ''}\n\n输入 ${C.accent('1')} 确认执行  ${C.accent('2')} 记住  ${C.accent('3')} 取消`,
      { title: '启动项目' }
    ) + '\n');

    pendingSystemOperation = {
      title: '启动项目',
      reason: `启动${startInfo.type}项目: ${startInfo.label}`,
      impact: startInfo.label,
      cwd,
      approvalKey: `start:${cwd}:${startInfo.label}`,
      steps: startInfo.needsInstall
        ? [{ label: '安装依赖', command: startInfo.command, args: ['install'], display: `${startInfo.command} install` },
           { label: startInfo.label, command: startInfo.command, args: startInfo.args, display: startInfo.label, background: true }]
        : [{ label: startInfo.label, command: startInfo.command, args: startInfo.args, display: startInfo.label, background: true }],
    };

    if (approvedSystemOperations.has(pendingSystemOperation.approvalKey)) {
      const operation = pendingSystemOperation;
      pendingSystemOperation = null;
      await executeStartProjectOperation(operation);
      return;
    }
    pendingConfirm = 'system';
    printSystemOperationConfirm(pendingSystemOperation);
  } catch (err) {
    console.log(`  ${I.err} 启动失败：${(err as Error).message}\n`);
  }
}

function printSystemOperationConfirm(operation: SystemOperation): void {
  activeChoicePanel = {
    title: '系统权限确认',
    options: [
      { id: 1, label: '允许执行一次' },
      { id: 2, label: `允许执行，并在本次会话记住：${operation.approvalKey}` },
      { id: 3, label: '取消' },
    ],
  };
  process.stdout.write(renderSystemOperationApproval(operation));
}

async function handleSystemOperationApprove(): Promise<void> {
  if (!pendingSystemOperation) return;
  const op = pendingSystemOperation;
  pendingSystemOperation = null;
  pendingConfirm = null;
  approvedSystemOperations.add(op.approvalKey);
  console.log(`  ${I.ok} 执行: ${C.accent(op.title)}\n`);
  await executeStartProjectOperation(op);
}

async function executeStartProjectOperation(operation: SystemOperation): Promise<void> {
  for (const step of operation.steps) {
    if (step.background) {
      await startBackgroundDevServer(step.command, step.args, operation.cwd, step.label);
      continue;
    }

    const installOk = await runForegroundCommand(step.command, step.args, operation.cwd, step.label, systemRunnerUi);
    if (!installOk) {
      console.log(`  ${I.err} 依赖安装失败，项目未启动\n`);
      return;
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const fsp = await import('fs/promises');
    await fsp.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function startBackgroundDevServer(command: string, args: string[], cwd: string, label: string): Promise<void> {
  await startBackgroundCommand({ command, args, cwd, label, startedProcesses, ui: systemRunnerUi });
}

function printCommandChunk(text: string): void {
  for (const line of formatCommandChunk(text)) {
    console.log(`  ${C.dim('│')} ${line}`);
  }
}

function formatRunnerMessage(message: string): string {
  return message.split('\n').map((line, index) => {
    if (line.startsWith('地址 ')) return `${C.dim('地址')} ${C.accent(line.slice(3))}`;
    if (index === 0) return line;
    return C.dim(line);
  }).join('\n  ');
}

async function cmdWrite(filesToWrite?: PendingFile[]): Promise<void> {
  // Called with explicit files → execute directly (from inline confirm)
  if (filesToWrite && filesToWrite.length > 0) {
    await doWriteFiles(filesToWrite);
    return;
  }
  // Called from /write slash command → show confirmation first
  if (state.pendingFiles.length === 0) { console.log(`  ${C.dim('没有待写入的文件')}\n`); return; }
  printFileConfirm();
  pendingConfirm = 'write';
}

async function doWriteFiles(targets: PendingFile[]): Promise<void> {
  const fsp = await import('fs/promises'); const path = await import('path'); const cwd = process.cwd(); let written = 0; let failed = 0; let totalLines = 0;
  console.log(`\n  ${C.accentBold(B.dot + ' 写入文件')} ${C.dim('(' + targets.length + ' 个)')}`); console.log(`  ${thinDivider()}`);
  const writtenFiles: PendingFile[] = [];
  for (const pf of targets) {
    try {
      pf.path = normalizePendingFilePath(pf.path);
      const full = path.resolve(cwd, pf.path);
      pf.fullPath = full;
      try { pf.previousContent = await fsp.readFile(full, 'utf-8'); pf.existed = true; } catch { pf.previousContent = ''; pf.existed = false; }
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, pf.content, 'utf-8');
      const stat = await fsp.stat(full);
      if (!stat.isFile()) throw new Error('写入后未检测到文件');
      const isNew = !pf.existed;
      console.log(`  ${I.ok} ${isNew ? C.success('新建') : C.warn('修改')} ${C.accent(pf.path.padEnd(36))} ${C.dim('+' + pf.lines + ' 行')}`);
      console.log(`    ${C.dim('路径')} ${C.accent(full)}`);
      console.log(`    ${C.success('已确认存在')} ${C.dim(stat.size + ' 字节')}`);
      written++;
      totalLines += pf.lines;
      writtenFiles.push(pf);
    } catch (err) {
      console.log(`  ${I.err} ${C.error(pf.path)} ${C.dim((err as Error).message)}`);
      failed++;
    }
  }
  state.lastWrittenFiles = [...state.lastWrittenFiles, ...writtenFiles];
  const writtenSet = new Set(writtenFiles);
  state.pendingFiles = state.pendingFiles.filter(file => !writtenSet.has(file));
  if (written > 0) { console.log(`  ${thinDivider()}`); console.log(`  ${I.ok} ${C.success(String(written))} 个文件  ${C.primary('+' + totalLines)} 行`); console.log(`  ${C.dim('下次可问：刚才写到哪里了')}\n`); }
  if (failed > 0) console.log(`  ${I.err} ${failed} 个文件写入失败，未从待写入列表移除\n`);
}

function printFileConfirm(): void {
  const fileOptions = state.pendingFiles.map((pf, index) => ({
    id: index + 1,
    label: `写入 ${pf.path}`,
    description: `+${pf.lines} 行`,
  }));
  const diffId = state.pendingFiles.length + 1;
  const undoId = state.pendingFiles.length + 2;
  activeChoicePanel = {
    title: '文件写入确认',
    subtitle: `${state.pendingFiles.length} 个文件待处理`,
    bodyLines: state.pendingFiles.map(pf => `文件 ${pf.path} (+${pf.lines} 行)`),
    options: [
      ...fileOptions,
      { id: diffId, label: '预览变更' },
      { id: undoId, label: '撤销/取消' },
    ],
    allowMultiple: true,
  };
  process.stdout.write(renderChoicePanel(activeChoicePanel));
}

async function cmdDiff(): Promise<void> {
  if (state.pendingFiles.length === 0) { console.log(`  ${C.dim('没有待预览的文件')}\n`); return; }
  const { renderDiff, filesToDiff, parseDiff } = await import('./diff-renderer.js');
  const diffText = filesToDiff(state.pendingFiles);
  const parsed = parseDiff(diffText);
  console.log(renderDiff(parsed, termWidth()) + '\n');
}

async function cmdUndo(): Promise<void> {
  if (state.lastWrittenFiles.length === 0) { console.log(`  ${C.dim('无已写入文件可撤销')}\n`); return; }
  const files = state.lastWrittenFiles.map(f => C.accent(f.path)).join(', ');
  process.stdout.write(`  ${C.dim('将撤销:')} ${files}\n`);
  process.stdout.write(`  ${C.accent('[1]')}${C.dim(' 确认撤销')}  ${C.accent('[2]')}${C.dim(' 取消')}\n`);
  process.stdout.write(`  ${C.dim('输入数字后回车。')}\n`);
  pendingConfirm = 'undo';
}

async function doUndoFiles(): Promise<void> {
  const fsp = await import('fs/promises'); const path = await import('path'); const cwd = process.cwd(); let undone = 0;
  for (const pf of state.lastWrittenFiles) { try { const full = pf.fullPath || path.resolve(cwd, pf.path); if (pf.previousContent !== undefined) { if (pf.previousContent === '') await fsp.unlink(full); else await fsp.writeFile(full, pf.previousContent, 'utf-8'); undone++; } } catch {} }
  state.lastWrittenFiles = []; console.log(`  ${I.ok} ${C.success(String(undone))} 个文件已撤销\n`);
}

async function cmdTestGen(): Promise<void> {
  const targets = state.lastWrittenFiles.filter(f => !f.path.includes('test') && !f.path.includes('.json') && !f.path.includes('.css'));
  if (targets.length === 0) { console.log(`  ${C.dim('无最近写入的源文件')}\n`); return; }
  await handleChat(`为以下文件生成测试，按 AI Output Contract JSON 返回完整文件内容：\n${targets.map(f => f.path).join('\n')}`);
}

async function cmdReport(): Promise<void> {
  if (state.conversation.length === 0) { console.log(`  ${C.dim('暂无对话')}\n`); return; }
  const fsp = await import('fs/promises'); const path2 = await import('path'); const cwd = process.cwd(); const rd = path2.join(cwd, '.icloser', 'reports'); await fsp.mkdir(rd, { recursive: true }); const rp = path2.join(rd, 'report-' + new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19) + '.md');
  const lns: string[] = []; lns.push('# iCloser 任务报告\n'); for (const msg of state.conversation) { lns.push(`**${msg.role === 'user' ? '用户' : 'AI'}**: ${msg.content.substring(0, 100)}\n`); }
  await fsp.writeFile(rp, lns.join('\n'), 'utf-8'); console.log(`  ${I.ok} 报告已保存: ${C.accent(rp)}\n`);
}

async function cmdCommit(msg: string): Promise<void> {
  // Check git status first
  let st = '';
  try { const { execFileSync } = await import('child_process'); const cwd = process.cwd(); st = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', timeout: 5000 }); } catch { console.log(`  ${C.dim('非 Git 仓库')}\n`); return; }
  if (!st.trim()) { console.log(`  ${C.dim('无变更')}\n`); return; }
  pendingCommitMsg = msg || 'iCloser: 代码修改';
  const files = st.trim().split('\n').slice(0, 6).map(l => l.trim().substring(3)).filter(Boolean);
  process.stdout.write(`  ${C.dim('Git 变更:')} ${files.map(f => C.accent(f)).join(', ')}${st.trim().split('\n').length > 6 ? C.dim(` +${st.trim().split('\n').length - 6} 个`) : ''}\n`);
  process.stdout.write(`  ${C.accent('[1]')}${C.dim(' 确认提交')}  ${C.accent('[2]')}${C.dim(' 取消')}\n`);
  process.stdout.write(`  ${C.dim('输入数字后回车。')}\n`);
  pendingConfirm = 'commit';
}

import type { AgentManager } from '../agent/manager.js';
let _agentManager: AgentManager | null = null;

function getAgentManager(): AgentManager {
  if (!_agentManager) {
    const { AgentManager: AM } = require('../agent/manager.js');
    _agentManager = new AM(state.aiConfig, 3);
  }
  return _agentManager!;
}

async function cmdOrchestrate(description: string): Promise<void> {
  const mgr = getAgentManager();
  console.log(`\n  ${I.running} ${chalk.bold('编排')} ${C.dim('拆解任务 → 并行执行 → 汇总')}`);
  console.log(`  ${C.dim('╭─')} ${C.accent(description.substring(0, 60))}`);
  const result = await mgr.orchestrate(description);
  if (result.success) {
    console.log(`  ${C.dim('├─')} ${I.ok} ${result.summary}`);
    for (let i = 0; i < result.childResults.length; i++) {
      const cr = result.childResults[i];
      const isLast = i === result.childResults.length - 1;
      const prefix = isLast ? '└─' : '├─';
      console.log(`  ${C.dim(prefix)} ${cr.success ? I.ok : I.err} ${cr.agentName} ${C.dim(cr.output.substring(0, 60))}`);
    }
    console.log('');
  } else {
    console.log(`  ${C.dim('╰─')} ${I.err} ${result.summary}\n`);
  }
}
async function cmdRunAgent(description: string): Promise<void> {
  const mgr = getAgentManager();
  const agent = mgr.create({ name: description, type: 'task' });
  console.log(`  ${I.ok} Agent ${C.accent(agent.id.substring(0, 10))} 已启动\n`);
  const started = await mgr.start(agent.id, description);
  if (!started) { console.log(`  ${C.warn('!')} Agent 排队等待中\n`); return; }
  const maxWait = 30000; const interval = 500; let waited = 0;
  while (waited < maxWait) {
    await new Promise(r => setTimeout(r, interval)); waited += interval;
    const current = mgr.get(agent.id);
    if (!current || current.status === 'done' || current.status === 'failed') break;
  }
  const final = mgr.get(agent.id);
  if (final?.status === 'done') { console.log(`  ${I.ok} Agent 完成 ${C.dim('(' + (final.result?.tokensUsed || 0) + ' tokens)')}\n`); }
  else if (final?.status === 'failed') { console.log(`  ${I.err} Agent 失败: ${final.result?.error || '未知错误'}\n`); }
  else { console.log(`  ${I.running} Agent 仍在运行中\n`); }
}

function cmdHistory(): void {
  const count = state.conversation.length;
  if (count === 0) { console.log(`  ${C.dim('暂无对话历史')}\n`); return; }
  console.log(`  ${C.accent(`对话历史 (${count} 条)`)}`);
  const recent = state.conversation.slice(-20);
  for (const m of recent) {
    const role = m.role === 'user' ? `${C.accent('◇ You')}` : `${C.primary('◆ AI')}`;
    const preview = m.content.length > 80 ? m.content.slice(0, 80) + '...' : m.content;
    console.log(`  ${role}  ${preview}`);
  }
  if (count > 20) console.log(`  ${C.dim(`... 还有 ${count - 20} 条`)}\n`);
  else console.log();
}

function cmdListAgents(): void {
  const mgr = _agentManager;
  if (!mgr || mgr.activeCount() === 0) { console.log(`  ${C.dim('无活跃 Agent')}\n`); return; }
  for (const a of mgr.list().slice(-10)) {
    const icon = a.status === 'done' ? I.ok : a.status === 'running' ? I.running : a.status === 'failed' ? I.err : I.hollow;
    const dur = a.result?.duration ? ` ${C.dim(a.result.duration + 'ms')}` : '';
    console.log(`  ${icon} ${C.accent(a.id.substring(0, 12))} ${C.dim(a.name.substring(0, 40))}${dur}`);
  }
  console.log('');
}
async function cmdAgentSlash(args: string): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]; const rest = parts.slice(1).join(' ');
  const mgr = getAgentManager();
  if (sub === 'stop' && rest) {
    if (mgr.stop(rest)) console.log(`  ${I.ok} Agent 已停止\n`);
    else console.log(`  ${C.warn('!')} Agent 不存在\n`);
  } else if (sub === 'status' && rest) {
    const a = mgr.get(rest);
    if (a) console.log(`  ${C.accent(a.name)} ${C.dim(`(${a.type})`)}  ${a.status}\n`);
    else console.log(`  ${C.warn('!')} Agent 不存在\n`);
  } else if (sub === 'create' && rest) {
    const typeStr = parts.includes('--type') ? parts[parts.indexOf('--type') + 1] || 'task' : 'task';
    const type = (typeStr === 'review' ? 'review' : typeStr === 'verify' ? 'verify' : typeStr === 'explore' ? 'explore' : typeStr === 'orchestrator' ? 'orchestrator' : 'task') as import('../types.js').AgentType;
    const name = parts.filter(p => !p.startsWith('--') && p !== sub).join(' ');
    const agent = mgr.create({ name, type });
    console.log(`  ${I.ok} Agent ${C.accent(agent.id.substring(0, 10))} 已创建\n`);
  } else {
    console.log(`  ${C.dim('用法: /agent [list|create <name>|start <id>|stop <id>|status <id>]')}\n`);
  }
}
async function cmdGlobalMemory(query: string): Promise<void> { try { const fsp = await import('fs/promises'); const path = await import('path'); const home = process.env.HOME || process.env.USERPROFILE || '~'; const mp = path.join(home, '.icloser', 'global-memory', 'memory.json'); if (query) { let mem: Record<string, unknown> = { entries: [] }; try { mem = JSON.parse(await fsp.readFile(mp, 'utf-8')); } catch {} (mem.entries as Array<unknown>).push({ content: query, ts: new Date().toISOString() }); await fsp.mkdir(path.dirname(mp), { recursive: true }); await fsp.writeFile(mp, JSON.stringify(mem, null, 2), 'utf-8'); console.log(`  ${I.ok} 已记录\n`); } else { try { const mem = JSON.parse(await fsp.readFile(mp, 'utf-8')); console.log(`  条目: ${(mem.entries as Array<unknown>).length}\n`); } catch { console.log(`  ${C.dim('全局记忆为空')}\n`); } } } catch { console.log(`  ${C.dim('无法读取全局记忆')}\n`); } }
async function cmdMemory(): Promise<void> { console.log(drawWideBox(`对话 ${C.accent(String(state.conversation.length))} 轮\n已写 ${C.accent(String(state.lastWrittenFiles.length))} 个文件`, { title: '会话记忆' }) + '\n'); }

async function cmdPrintLastWrittenFiles(): Promise<void> {
  if (state.lastWrittenFiles.length === 0) {
    console.log(`  ${C.dim('当前会话还没有成功写入文件')}\n`);
    return;
  }
  const fsp = await import('fs/promises');
  const pathLines = await Promise.all(state.lastWrittenFiles.slice(-10).map(async file => {
    const absolute = file.fullPath || nodePath.resolve(process.cwd(), file.path);
    try {
      const stat = await fsp.stat(absolute);
      return `${C.success('✓ 已确认存在')} ${C.accent(file.path)} ${C.dim(stat.size + ' 字节')}\n  ${C.dim(absolute)}`;
    } catch {
      return `${C.warn('! 未找到')} ${C.accent(file.path)}\n  ${C.error(absolute)}\n  ${C.dim('可能已被移动/删除，或当前查看的不是同一个磁盘路径。')}`;
    }
  }));
  console.log(drawWideBox(pathLines.join('\n'), { title: '最近写入位置' }) + '\n');
}

// Repl /status
async function cmdReplStatus(): Promise<void> {
  const idx = state.projectIndex; const st = Math.round(estimateContextTokens()); const tp = state.aiConfig.maxTokens > 0 ? Math.round((st / state.aiConfig.maxTokens) * 100) : 0;
  console.log(drawWideBox(`模型 ${C.accent(state.aiConfig.provider)}${C.dim(' / ' + state.aiConfig.model)}\n项目 ${state.context.projectName || C.dim('—')}\n工作目录 ${C.accent(process.cwd())}\n语言 ${state.context.language || C.dim('—')}${state.context.framework ? '  |  ' + state.context.framework : ''}\n索引 ${idx ? C.accent(idx.fileCount + '文件 ' + idx.moduleCount + '模块') : C.dim('未扫描')}\n对话 ${C.accent(String(state.conversation.length))} 轮\n上下文 ${C.primary(String(st))} / ${C.accent(String(state.aiConfig.maxTokens))} ${C.dim('(' + tp + '%)')}`, { title: '会话状态' }) + '\n');
  await printReplVerifyStatus();
}
async function printReplVerifyStatus(): Promise<void> { try { const { listTasks } = await import('../core/task-engine.js'); const tasks = await listTasks(process.cwd()); const withVr = tasks.filter(t => t.verifyResult); if (withVr.length === 0) return; const latest = withVr[0]; const vr = latest.verifyResult!; console.log(`  ${thinDivider()}`); console.log(`  ${C.dim('验证结果')}  ${vr.overall === 'pass' ? C.success('通过') : C.error('失败')}  ${C.dim('任务 ' + latest.id.substring(0, 10))}`); for (const s of vr.stages) { const icon = s.status === 'pass' ? I.ok : s.status === 'fail' ? I.err : I.warn; const dur = s.duration > 0 ? ' ' + C.dim((s.duration / 1000).toFixed(1) + 's') : ''; const ec = s.exitCode != null ? ' ' + C.dim('退出码=' + s.exitCode) : ''; const stageStatus = s.status === 'pass' ? '通过' : s.status === 'fail' ? '失败' : '警告'; console.log('  ' + icon + ' ' + s.stage.padEnd(16) + C.dim(stageStatus) + dur + ec); if (s.command) console.log('    ' + C.dim('$ ' + s.command.substring(0, 65))); if (s.status === 'fail') { const et = s.stderr || s.errorDetails || ''; if (et.trim()) { for (const l of et.trim().split('\n').filter((l: string) => l.trim()).slice(0, 3)) console.log('    ' + C.error(l.substring(0, 80).trim())); } } } console.log(''); } catch {} }

async function cmdDoctor(): Promise<void> {
  const cwd = process.cwd();
  const path = await import('path');
  const fsp = await import('fs/promises');
  const config = await loadConfig(cwd);
  const indexPath = path.join(cwd, '.icloser', 'index.json');
  let indexExists = false;
  try {
    await fsp.access(indexPath);
    indexExists = true;
  } catch {}

  const providerStatus = config ? getProviderStatus(config.ai) : getProviderStatus(state.aiConfig);
  const ready = Boolean(config && providerStatus.ready && indexExists);
  const nextActions: string[] = [];

  if (!config) {
    nextActions.push('/init');
    nextActions.push('直接粘贴 API Key，或输入 /apikey');
  } else if (!providerStatus.ready && providerStatus.requiresApiKey) {
    nextActions.push('直接粘贴 API Key，或输入 /apikey');
    nextActions.push('/apikey');
  }

  if (config && !indexExists) {
    nextActions.push('/scan');
  }

  if (ready) {
    nextActions.push('直接输入你的需求，例如：帮我给登录模块加手机号验证码登录');
  }

  const lines = [
    `项目 ${config ? C.success('已初始化') : C.warn('未初始化')}`,
    `模型 ${C.accent(providerStatus.name)} ${providerStatus.ready ? C.success(providerStatus.keySource) : C.warn(providerStatus.keySource || '未配置')}`,
    `索引 ${indexExists ? C.success('已生成') : C.warn('未扫描')}`,
    `状态 ${ready ? C.success('可用') : C.warn('需要处理')}`,
  ];

  if (nextActions.length > 0) {
    lines.push('');
    lines.push(C.bright('下一步'));
    nextActions.forEach((action, index) => {
      lines.push(`${C.accent(String(index + 1))}  ${action}`);
    });
  }

  console.log(drawWideBox(lines.join('\n'), { title: '诊断' }) + '\n');
}

// ============================================================
// Renderers
// ============================================================
let tableHeaderSeen = false;
function renderMarkdownLine(line: string, maxW: number): void {
  if (line.trim() === '') { tableHeaderSeen = false; process.stdout.write('\n'); return; }
  const hM = line.match(/^(#{1,4})\s+(.+)/); if (hM) { tableHeaderSeen = false; const t = hM[2]; process.stdout.write('  ' + (hM[1].length === 1 ? chalk.bold.underline(C.bright(t)) : chalk.bold(C.bright(t))) + '\n'); return; }
  if (line.trim().startsWith('> ')) { tableHeaderSeen = false; process.stdout.write(`  ${C.dim('▎')} ${C.dim(line.trim().slice(2))}\n`); return; }
  if (/^[-*_]{3,}\s*$/.test(line.trim())) { tableHeaderSeen = false; process.stdout.write(`  ${C.dim('─'.repeat(Math.min(maxW, 60)))}\n`); return; }
  const ulM = line.match(/^(\s*)[-*+]\s+(.+)/); if (ulM) { tableHeaderSeen = false; process.stdout.write('  ' + C.primary('•') + ' ' + renderInlineFormatting(ulM[2]) + '\n'); return; }
  const olM = line.match(/^(\s*)(\d+)\.\s+(.+)/); if (olM) { tableHeaderSeen = false; process.stdout.write('  ' + C.dim(olM[2] + '.') + ' ' + renderInlineFormatting(olM[3]) + '\n'); return; }
  // Table rows
  if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
    const cells = line.trim().split('|').filter(c => c.trim()).map(c => c.trim());
    // Separator row: |---|----|
    if (cells.every(c => /^:?-{3,}:?$/.test(c))) {
      tableHeaderSeen = true;
      process.stdout.write(`  ${C.dim('├─' + cells.map(() => '─'.repeat(10)).join('─┼─') + '─┤')}\n`);
      return;
    }
    const isHeader = !tableHeaderSeen && cells.length > 0;
    if (isHeader) tableHeaderSeen = true;
    const maxCellW = Math.min(26, Math.floor((maxW - 4) / Math.max(cells.length, 1)));
    const rendered = cells.map((c, i) => {
      const display = c.length > maxCellW ? c.substring(0, maxCellW - 1) + '…' : c;
      return isHeader ? chalk.bold(display) : C.dim(display);
    }).join(C.dim(' │ '));
    process.stdout.write(`  ${C.dim('│')} ${rendered} ${C.dim('│')}\n`);
    return;
  }
  tableHeaderSeen = false;
  process.stdout.write('  ' + renderInlineFormatting(line) + '\n');
}
function renderInlineFormatting(text: string): string { let t = text; t = t.replace(/\*\*(.+?)\*\*/g, (_, m) => chalk.bold(m)); t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, m) => chalk.italic(m)); t = t.replace(/`([^`]+)`/g, (_, m) => C.accent(m)); return t; }

function printFooter(_hasFiles: boolean): void {
  // S20 panel handles file confirmation — old inline system disabled
}

function stripAnsiLen(str: string): number { return str.replace(/\x1b\[[0-9;]*m/g, '').length; }

// S20.2 Waiting UX — three-phase feedback
const WAIT_PULSE = ['◉', '◔', '◑', '◕'];
const WAIT_BAR = '█';
const WAIT_BAR_EMPTY = '░';

function startWaitingPhase(): void {
  waitingStartTime = Date.now();
  streamTokenCount = 0;
  spinnerIdx = 0;
  let tick = 0;
  spinnerTimer = setInterval(() => {
    tick++;
    if (streamState === 'streaming') { startStreamingPhase(); return; }
    if (streamState === 'idle') { stopWaitingPhase(); return; }
    const elapsed = ((Date.now() - waitingStartTime) / 1000).toFixed(1);
    const pulse = WAIT_PULSE[spinnerIdx];
    const barLen = 20;
    const progI = Math.min(Math.floor((tick * 3) % barLen), barLen - 1);
    const bar = WAIT_BAR.repeat(progI) + WAIT_BAR_EMPTY.repeat(barLen - progI);
    process.stdout.write(`\r  ${C.primary(pulse)} ${chalk.bold('AI')} ${C.dim('分析中')} ${C.primary(`[${elapsed}s]`)}  ${C.dim(bar)}`);
    spinnerIdx = (spinnerIdx + 1) % WAIT_PULSE.length;
    // Show hint after 10s
    if (tick === 125) {
      process.stdout.write(`\n  ${C.dim('复杂任务可能需要 10-30 秒，Ctrl+C 可中断')}`);
    }
  }, 80);
}

function startStreamingPhase(): void {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
  // One-time transition — no continuous updates (corrupts stream output with \r)
  process.stdout.write(`\r\x1b[K  ${C.primary('◉')} ${chalk.bold('AI')} ${C.dim('输出中...')}\n\n`);
}

function stopWaitingPhase(): void {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
  // Status line printed by stream handler or startStreamingPhase — no duplicate here
}

function startSpinner(): void { startWaitingPhase(); }
function stopSpinner(): void { stopWaitingPhase(); }

export function replCompleter(line: string): [string[], string] {
  if (!line.startsWith('/')) return [[], line];

  const providerNames = getAvailableProviders().map(provider => provider.name);
  const trimmedRight = line.replace(/\s+$/, '');
  const endsWithSpace = /\s$/.test(line);
  const parts = trimmedRight.split(/\s+/);

  // Partial command: /<prefix> without space → complete command name
  if (parts.length === 1 && !endsWithSpace) {
    const prefix = parts[0];
    // Empty prefix (just "/") → show popular commands only
    if (prefix === '/') {
      const popular = ['/help', '/init', '/scan', '/start', '/stop', '/status', '/doctor', '/exit', '/write', '/diff', '/config', '/apikey'];
      return [popular.map(c => `${c} `), line];
    }
    const hits = SLASH_COMMANDS.filter(command => command.startsWith(prefix));
    return [hits.map(command => `${command} `), line];
  }

  // Full command with trailing space → show sub-command hints
  if (parts.length === 1 && endsWithSpace) {
    const cmd = parts[0];
    if (cmd === '/config') return [['provider ', 'model '], line];
    if (cmd === '/apikey' || cmd === '/key') return [providerNames.map(p => `${p} `), line];
    if (cmd === '/write' || cmd === '/diff' || cmd === '/code') {
      // S20.9: file path completion for file-aware commands
      const hintPart = endsWithSpace ? '' : (parts[1] || '');
      try {
        const fs = require('fs'); const p = require('path');
        const dir = hintPart ? p.dirname(hintPart) : '.';
        const prefix = hintPart ? p.basename(hintPart) : '';
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const matches = entries.filter((e: { name: string }) => e.name.startsWith(prefix)).map((e: { name: string }) => `${hintPart ? hintPart.substring(0, hintPart.length - prefix.length) : ''}${e.name} `);
        return [matches.slice(0, 20), line];
      } catch { return [[], line]; }
    }
    return [[], line];
  }
  // Multi-part commands — deep sub-completions
  if (parts.length >= 2) {
    if (parts[0] === '/config') {
      if (parts.length === 2 && !endsWithSpace) {
        const keys = ['provider', 'model'].filter(key => key.startsWith(parts[1]));
        return [keys.map(key => `/config ${key} `), line];
      }
      if (parts[1] === 'provider') {
        const partial = parts.length >= 3 && !endsWithSpace ? parts[2] : '';
        const hits = providerNames.filter(p => p.startsWith(partial));
        return [hits.map(p => `/config provider ${p}`), line];
      }
      if (parts[1] === 'model') {
        const partial = parts.length >= 3 && !endsWithSpace ? parts[2] : '';
        const info = getProviderInfo(state.aiConfig.provider);
        const hits = info.availableModels.filter(m => m.startsWith(partial));
        return [hits.map(m => `/config model ${m}`), line];
      }
    }
    if (parts[0] === '/apikey' || parts[0] === '/key') {
      if (parts.length === 2 && !endsWithSpace) {
        const hits = providerNames.filter(p => p.startsWith(parts[1]));
        return [hits.map(p => `${parts[0]} ${p} `), line];
      }
    }
    return [[], line];
  }
  // S20.8: history search — !prefix triggers history search
  if (line.startsWith('!') && line.length > 1) {
    const query = line.substring(1).toLowerCase();
    const hits = state.conversation
      .filter(m => m.role === 'user' && m.content.toLowerCase().includes(query))
      .map(m => m.content.substring(0, 80))
      .slice(-8);
    return [hits, line];
  }
  return [[], line];
}

// S20.7: command palette
function renderCommandPalette(filter: string): string {
  const tw = termWidth(); const w = tw - 4;
  const all = [
    { name: '/help', desc: '查看帮助', aliases: '/h /?' },
    { name: '/scan', desc: '扫描项目并更新索引', aliases: '/s' },
    { name: '/verify', desc: '验证项目', aliases: '/v' },
    { name: '/write', desc: '写入待确认文件', aliases: '/w' },
    { name: '/diff', desc: '预览代码变更', aliases: '/d' },
    { name: '/undo', desc: '撤销上次写入', aliases: '' },
    { name: '/test', desc: '生成测试', aliases: '/tt' },
    { name: '/report', desc: '生成任务报告', aliases: '/rp' },
    { name: '/commit', desc: '提交 Git', aliases: '' },
    { name: '/status', desc: '查看状态', aliases: '' },
    { name: '/doctor', desc: '诊断下一步动作', aliases: '' },
    { name: '/config', desc: '查看和修改配置', aliases: '/cd' },
    { name: '/apikey', desc: '输入 API Key', aliases: '/key' },
    { name: '/run', desc: 'Agent 执行任务', aliases: '' },
    { name: '/agents', desc: 'Agent 列表', aliases: '/ag' },
    { name: '/orchestrate', desc: '多 Agent 编排', aliases: '' },
    { name: '/search', desc: '搜索代码', aliases: '' },
    { name: '/intel', desc: '代码智能查询', aliases: '/code' },
    { name: '/context', desc: '查看上下文', aliases: '/ctx' },
    { name: '/memory', desc: '查看记忆', aliases: '/mem' },
    { name: '/start', desc: '启动开发服务器', aliases: '/serve' },
    { name: '/stop', desc: '停止服务', aliases: '' },
    { name: '/docs', desc: '文档操作: ask/summarize/review/rewrite/changelog', aliases: '' },
    { name: '/restart', desc: '重启服务', aliases: '' },
    { name: '/brief', desc: '简洁模式(折叠代码块)', aliases: '' },
    { name: '/full', desc: '详细模式(完整输出)', aliases: '' },
    { name: '/clear', desc: '清空对话历史', aliases: '/c' },
    { name: '/exit', desc: '退出 REPL', aliases: '/quit /q' },
  ];
  const q = filter.toLowerCase();
  const matched = q ? all.filter(c => c.name.includes(q) || c.desc.includes(q) || c.aliases.includes(q)) : all;
  let out = `\n  ${C.accent('╭─')} ${C.accent('命令面板')} ${C.accent('─'.repeat(w - 10) + '╮')}\n`;
  if (q) { out += `  ${C.accent('│')} ${C.dim('> ' + filter)}${' '.repeat(w - 3 - filter.length)}${C.accent('│')}\n`; }
  out += `  ${C.accent('│')} ${C.dim('─'.repeat(w - 2))} ${C.accent('│')}\n`;
  for (const c of matched.slice(0, 20)) {
    const line = `${C.accent(c.name.padEnd(16))} ${C.dim(c.desc)}`;
    out += `  ${C.accent('│')} ${line}${' '.repeat(Math.max(0, w - 2 - line.replace(/\x1b\[[0-9;]*m/g, '').length))}${C.accent('│')}\n`;
  }
  out += `  ${C.accent('╰')}${C.accent('─'.repeat(w))}${C.accent('╯')}`;
  return out;
}

async function cmdCommandPalette(query: string): Promise<void> {
  console.log(renderCommandPalette(query));
  console.log(`  ${C.dim('输入完整命令或 /? 返回')}\n`);
}

// S20.8: history search via ! prefix
async function cmdHistorySearch(query: string): Promise<void> {
  const q = query.toLowerCase();
  const hits = state.conversation
    .filter(m => m.role === 'user' && m.content.toLowerCase().includes(q))
    .slice(-10);
  if (hits.length === 0) { console.log(`  ${C.dim('无匹配历史')}\n`); return; }
  console.log(`\n  ${C.accent('╭─')} ${C.accent('历史搜索: ' + query)} ${C.accent('─'.repeat(40)) + '╮'}`);
  for (let i = 0; i < hits.length; i++) {
    const display = hits[i].content.length > 70 ? hits[i].content.substring(0, 67) + '…' : hits[i].content;
    console.log(`  ${C.accent('│')} ${C.dim(String(i + 1).padStart(2))} ${C.dim('│')} ${display}`);
  }
  console.log(`  ${C.accent('╰')}${C.accent('─'.repeat(50))}${C.accent('╯')}`);
  console.log(`  ${C.dim('输入数字选择历史，或输入任意内容继续')}\n`);
}

function resolveApiKeyForProvider(provider: AIProvider): string {
  if (state.aiConfig.provider === provider && state.aiConfig.apiKey) {
    return state.aiConfig.apiKey;
  }
  const info = getProviderInfo(provider);
  for (const envVar of info.envVars) {
    const value = process.env[envVar];
    if (value) return value;
  }
  return '';
}

function enableOfflineModeIfMissingKey(): { provider: AIProvider } | null {
  const status = getProviderStatus(state.aiConfig);
  if (status.ready || !status.requiresApiKey) return null;

  // Key is missing — fall back to mock so the system still works,
  // but remember the user's intended provider for when they add a key
  const previousProvider = state.aiConfig.provider;
  state._pendingKeyProvider = previousProvider;
  state.aiConfig.provider = 'mock';
  state.aiConfig.model = getProviderInfo('mock').defaultModel;
  state.aiConfig.apiKey = '';
  return { provider: previousProvider };
}

function printProviderKeyHelp(provider: AIProvider): void {
  console.log(`  ${C.success('最简单：把 API Key 粘贴到这里，然后回车。')}`);
  console.log(`  ${C.dim('不用写命令，不用设置环境变量。')}`);
  console.log(`  ${C.dim(`想指定 Provider 时再用：/apikey ${provider} <你的 API Key>`)}`);
  console.log(`  ${C.dim('高级用户也可以用下面的终端格式：')}`);
  for (const line of formatProviderKeyGuidance(provider)) {
    console.log(`  ${C.dim(line)}`);
  }
  console.log('');
}

async function loadGlobalConfig(): Promise<void> { try { const fsp = await import('fs/promises'); const path = await import('path'); const home = process.env.HOME || process.env.USERPROFILE || '~'; const cp = path.join(home, '.icloser', 'config.json'); const cfg = JSON.parse(await fsp.readFile(cp, 'utf-8')); const ai = cfg.ai || {}; if (ai.provider) state.aiConfig.provider = ai.provider; if (ai.model) state.aiConfig.model = ai.model; if (ai.apiKey) state.aiConfig.apiKey = ai.apiKey; if (ai.maxTokens) state.aiConfig.maxTokens = ai.maxTokens; } catch {} }
async function saveSession(): Promise<void> { try { const fsp = await import('fs/promises'); const path = await import('path'); const home = process.env.HOME || process.env.USERPROFILE || '~'; const sp = path.join(home, '.icloser', 'session.json'); const cwd = process.cwd(); const recentFiles = state.lastWrittenFiles.slice(-20).map(file => ({ path: file.path, fullPath: file.fullPath, lines: file.lines, content: '' })); await fsp.mkdir(path.dirname(sp), { recursive: true }); await fsp.writeFile(sp, JSON.stringify({ projectRoot: cwd, projectName: state.context.projectName, language: state.context.language, framework: state.context.framework, conversation: state.conversation.slice(-20), lastWrittenFiles: recentFiles, savedAt: new Date().toISOString() }, null, 2), 'utf-8'); } catch {} }
async function loadSession(): Promise<boolean> { try { const fsp = await import('fs/promises'); const path = await import('path'); const home = process.env.HOME || process.env.USERPROFILE || '~'; const sp = path.join(home, '.icloser', 'session.json'); const data = JSON.parse(await fsp.readFile(sp, 'utf-8')); if (Date.now() - new Date(data.savedAt as string).getTime() > 86400000) return false; const savedRoot = data.projectRoot ? path.resolve(String(data.projectRoot)) : ''; const currentRoot = path.resolve(process.cwd()); if (savedRoot !== currentRoot) return false; if (data.conversation) state.conversation = data.conversation as Message[]; if (Array.isArray(data.lastWrittenFiles)) state.lastWrittenFiles = data.lastWrittenFiles.map((file: Partial<PendingFile>) => ({ path: file.path || '', fullPath: file.fullPath, lines: file.lines || 0, content: '' })).filter((file: PendingFile) => file.path); return state.conversation.length > 0 || state.lastWrittenFiles.length > 0; } catch { return false; } }
async function detectProjectContext(): Promise<void> {
  const path = await import('path');
  const cwd = process.cwd();
  state.projectRoot = cwd;
  state.context = {
    projectName: path.basename(cwd),
    language: '',
    framework: '',
    database: '',
    buildSystem: '',
    testFramework: '',
  };

  try {
    const fsp = await import('fs/promises');
    const files = await fsp.readdir(cwd);
    if (files.includes('package.json')) {
      const pkg = JSON.parse(await fsp.readFile(path.join(cwd, 'package.json'), 'utf-8'));
      state.context.language = pkg.devDependencies?.typescript || files.includes('tsconfig.json') ? 'TypeScript/JS' : 'JavaScript';
      state.context.buildSystem = 'npm';
      if (pkg.dependencies?.react) state.context.framework = 'React';
      else if (pkg.dependencies?.next) state.context.framework = 'Next.js';
      else if (pkg.dependencies?.express) state.context.framework = 'Express';
    } else if (files.includes('go.mod')) {
      state.context.language = 'Go';
      state.context.buildSystem = 'go';
    } else if (files.includes('Cargo.toml')) {
      state.context.language = 'Rust';
      state.context.buildSystem = 'cargo';
    }
  } catch {}
}
function buildSystemPrompt(): string {
  const ctx = state.context;
  const idx = state.projectIndex;
  const cwd = process.cwd();
  let p = '你是 iCloser Agent Shell，运行在用户当前项目目录里的终端 AI 工程助手。\n';
  p += '你可以基于 iCloser 已注入的项目索引、相关源码片段和记忆进行分析。';
  p += '不要回答”我无法访问文件系统/当前路径/目录”；如果上下文不足，应说明已掌握的路径和建议用户运行 /scan 或指定更具体范围。\n\n';
  p += '## 当前工作目录\n' + cwd + '\n\n';
  p += '## 项目\n- 名称: ' + (ctx.projectName || cwd.split(/[/\\]/).pop() || '—') + '\n- 语言: ' + (ctx.language || '—') + '\n- 框架: ' + (ctx.framework || '—') + '\n- OS: ' + process.platform;

  // S17.1: Tool capability injection
  try {
    const { buildToolCapabilitySnapshot } = require('../core/tool-registry.js');
    const snapshot = buildToolCapabilitySnapshot();
    p += '\n\n## 本地工具能力（S17.1）';
    p += '\n' + snapshot.capabilities.map((c: { name: string; status: string; purpose: string; fallback: string }) => {
      if (c.status === 'available') return `- ${c.name}：${c.purpose}`;
      return `- ${c.name}（降级）：${c.fallback}`;
    }).join('\n');
  } catch { /* non-critical */ }

  if (idx) {
    p += '\n\n## 结构\n文件: ' + idx.fileCount + ' | 模块: ' + idx.moduleCount + ' | 架构: ' + idx.architecture + '\n' + idx.modules.slice(0, 10).map(m => '- ' + m.name + ' (' + m.files + ' 文件)').join('\n');
  }
  p += '\n\n## 回答规则\n1. 用户要求分析当前目录、整个目录、代码质量、项目结构时，直接基于已注入上下文分析，不要要求用户粘贴文件\n2. 需要写文件时，只输出一个 JSON 代码块\n3. JSON 结构为 {“summary”:”本次修改摘要”,”changes”:[{“file”:”相对路径”,”operation”:”write”,”content”:”完整文件内容”,”reasoning”:”为什么修改”}]}\n4. changes 至少 1 项，operation 只能是 write，content 必须是完整文件内容\n5. 中文说明写在 summary/reasoning 中，代码术语保留英文\n6. 不需要写文件时，简洁直接回复，并列出依据的文件/模块';
  return p;
}

async function buildRichContext(input: string): Promise<ContextPackage> {
  const rootPath = state.projectRoot || process.cwd();
  try {
    const { assembleContextFromProject } = await import('../core/context.js');
    const context = await assembleContextFromProject(
      rootPath,
      {
        id: `repl-${Date.now().toString(36)}`,
        description: input,
        status: 'queued',
        priority: 'normal',
        createdAt: new Date().toISOString(),
        changes: [],
        diffs: [],
        reasoning: [],
        errorLog: [],
        retryCount: 0,
        maxRetries: 3,
        agentExecutions: [],
      },
      { maxTokens: 24000, scanIfMissing: true }
    );

    const { loadProjectIndex } = await import('../core/scanner.js');
    const index = await loadProjectIndex(rootPath);
    if (index) {
      applyProjectIdentity(rootPath, index.identity);
      state.projectIndex = summarizeProjectIndex(index);
    }

    if (isWholeProjectAnalysisIntent(input)) {
      context.relevantMemory = [
        context.relevantMemory,
        '用户要求分析当前目录/整个项目。请结合项目索引、模块列表、依赖、已注入源码片段给出整体代码质量分析；不要声称无法访问当前路径。',
      ].filter(Boolean).join('\n\n');
    }

    return context;
  } catch {
    const fallback = await buildFallbackDirectoryContext(rootPath);
    return fallback;
  }
}

function isWholeProjectAnalysisIntent(input: string): boolean {
  return /(整个目录|当前目录|整个项目|代码质量|质量分析|分析代码|扫描项目|项目结构)/.test(input);
}

async function buildFallbackDirectoryContext(rootPath: string): Promise<ContextPackage> {
  const fsp = await import('fs/promises');
  const path = await import('path');
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3 || files.length >= 40) return;
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else files.push(path.relative(rootPath, full).replace(/\\/g, '/'));
      }
    } catch {}
  }
  await walk(rootPath, 0);
  return {
    projectMeta: JSON.stringify({
      ...state.context,
      rootPath,
      files: files.slice(0, 40),
      note: 'fallback directory listing; scanner unavailable',
    }),
    relevantCode: [],
    relevantMemory: 'iCloser 已获取当前目录文件列表，但核心扫描失败。请基于文件列表给出可行分析，并建议运行 /scan 刷新索引。',
    totalTokens: 0,
    budgetUsed: 0,
  };
}
function estimateContextTokens(): number { let t = 0; for (const m of state.conversation) t += m.content.length / 2; return t; }

export function normalizePendingFilePath(filePath: string): string {
  const cleaned = filePath.trim().replace(/\\/g, '/').replace(/^["']|["']$/g, '').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!isMarkdownDocumentPath(cleaned)) return cleaned;

  const parts = cleaned.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || 'document.md';
  if (parts[0]?.toLowerCase() === 'docs' && parts.length >= 2) return parts.join('/');
  return `docs/${fileName}`;
}

function isMarkdownDocumentPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function extractFileBlocks(content: string, input = ''): PendingFile[] {
  clearPendingFileConfirmation();
  if (!isWriteIntendedInput(input) && !containsExplicitWriteContract(content)) return [];

  try {
    const output = parseAIOutput(content);
    state.pendingFiles = output.changes.map(change => ({
      path: normalizePendingFilePath(change.file),
      content: change.content,
      lines: change.content.split('\n').length,
    }));
    return state.pendingFiles;
  } catch {
    const files: PendingFile[] = [];
    const re = /```write:(\S+)\s*\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const fc = m[2];
      files.push({ path: normalizePendingFilePath(m[1].trim()), content: fc, lines: fc.split('\n').length });
    }
    state.pendingFiles = files;
    return files;
  }
}

export function isWriteIntendedInput(input: string): boolean {
  return /(写入|创建|生成|新增|修改|保存|补齐|补全|修复|改写|更新|文档|PRD|readme|docs?|write|create|generate|update|save|fix)/i.test(input);
}

function containsExplicitWriteContract(content: string): boolean {
  return /```write:\S+\s*\n[\s\S]*?```/i.test(content)
    || /```(?:json|icloser-ai-output)\s*\n[\s\S]*"changes"\s*:\s*\[[\s\S]*```/i.test(content)
    || /^\s*\{[\s\S]*"changes"\s*:\s*\[[\s\S]*\}\s*$/.test(content);
}

function shouldRepairWriteOutput(input: string, output: string): boolean {
  // Only repair if user clearly intended a write AND the output looks like a partial AI contract
  const taskLooksWritable = isWriteIntendedInput(input);
  // Narrower: only trigger when output mentions the contract structure but is incomplete
  const hasContractHints = /"changes"\s*:|"operation"\s*:\s*"write"|"summary"\s*:|```json\s*\{/.test(output);
  // Must NOT already have valid file blocks (defense in depth)
  const hasValidBlocks = extractFileBlocks(output, input).length > 0;
  return taskLooksWritable && hasContractHints && !hasValidBlocks;
}

// S21: extract file paths mentioned in AI response for activity summary
function extractMentionedFiles(text: string): string[] {
  const seen = new Set<string>();
  // Match patterns like `src/config.ts`, `doc/README.md`, `tests/foo.test.ts`
  const pattern = /\b[\w.-]+\/[\w./-]+\.\w{1,10}\b/g;
  for (const m of text.matchAll(pattern)) {
    const file = m[0];
    if (/\.[a-z]{1,6}$/i.test(file) && !file.startsWith('http')) seen.add(file);
  }
  return [...seen];
}

function shouldHideWriteJsonBlock(_input: string, codeLang: string): boolean {
  // JSON output blocks are ALWAYS hidden — they are the AI output contract, not user content
  return /(json|icloser-ai-output)/i.test(codeLang);
}

async function repairWriteOutput(
  provider: ReturnType<typeof createProvider>,
  originalPrompt: AIPrompt,
  rawOutput: string
): Promise<PendingFile[]> {
  console.log(`\n  ${C.warn('!')} 写入方案格式不完整，正在自动整理为可执行操作...`);

  // Max wait for AI repair — increase to 30s for complex outputs
  const maxWaitMs = 30000;
  const startTime = Date.now();

  try {
    const repairPrompt: AIPrompt = {
      ...originalPrompt,
      systemPrompt: [
        '你是 iCloser 的写入方案修复器。',
        '你只能输出一个严格 JSON 代码块，不能输出解释。',
        'JSON 结构必须是 {"summary":"...","changes":[{"file":"相对路径","operation":"write","content":"完整文件内容","reasoning":"..."}]}。',
        'operation 只能是 write。',
        'content 必须是完整文件内容，不能省略，不能用占位符。',
        '如果原输出缺少 content，请根据用户任务和上下文生成完整可写入内容。',
      ].join('\n'),
      task: [
        '用户原始任务：',
        originalPrompt.task,
        '',
        '模型上一轮输出如下，请修复成可执行 JSON：',
        rawOutput.substring(0, 3000),
      ].join('\n'),
      history: '',
    };

    // Race: AI repair vs timeout
    const repaired = await Promise.race([
      provider.chat(repairPrompt),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), maxWaitMs)),
    ]);

    if (repaired) {
      const elapsed = Date.now() - startTime;
      const fileBlocks = extractFileBlocks(repaired.content, originalPrompt.task);
      if (fileBlocks.length > 0) {
        console.log(`  ${I.ok} 已整理出 ${C.accent(String(fileBlocks.length))} 个待写入文件 ${C.dim('(' + elapsed + 'ms)')}`);
        return fileBlocks;
      }
    }
  } catch { /* fall through */ }

  // Fallback: try to extract file blocks from the ORIGINAL output
  // before giving up — the AI may have written valid content in non-JSON format
  const fallbackBlocks = extractFileBlocks(rawOutput, originalPrompt.task);
  if (fallbackBlocks.length > 0) {
    console.log(`  ${I.ok} 从原始输出提取了 ${C.accent(String(fallbackBlocks.length))} 个待写入文件\n`);
    return fallbackBlocks;
  }

  console.log(`  ${C.warn('!')} 仍无法生成可写入文件。请重新输入更具体的描述，例如：${C.accent('创建 docs/PRD.md，写完整 PRD 文档')}\n`);
  return [];
}

async function cmdSearch(pattern: string): Promise<void> {
  try { const { execFileSync } = await import('child_process'); try { const out = execFileSync('rg', ['--no-heading', '-n', pattern, '--type-not', 'binary', '-g', '!node_modules', '-g', '!.git', '-g', '!dist', '.'], { cwd: process.cwd(), encoding: 'utf-8', timeout: 10000 }); const lines = out.trim().split('\n').slice(0, 15); for (const l of lines) { const [f, ln, ...rest] = l.split(':'); console.log(`  ${C.accent(f)}:${C.primary(ln)} ${C.dim(rest.join(':').trim().substring(0, 80))}`); } console.log(''); } catch { console.log(`  ${C.dim('无匹配')}\n`); } } catch { console.log(`  ${C.dim('搜索不可用')}\n`); }
}
async function cmdIntel(query: string): Promise<void> {
  const rootPath = process.cwd();
  const q = query.trim();
  try {
    const { loadProjectIndex } = await import('../core/scanner.js');
    const index = await loadProjectIndex(rootPath);
    if (!index) { console.log(`  ${C.dim('项目未扫描，先运行 ic scan')}\n`); return; }

    // Determine intent
    const whoCalls = q.match(/谁(?:在)?调用[了]?[：:\s]*(\S+)/i);
    const whereDefined = q.match(/(\S+)\s*(?:在|的).*定义/i);
    const whatExports = q.match(/(\S+)\s*(?:文件|模块).*(?:导出|export)/i);
    const depsOf = q.match(/(\S+)\s*(?:模块).*(?:依赖|import)/i);

    // Look up symbol in exports
    if (whoCalls || whereDefined) {
      const symbol = (whoCalls?.[1] || whereDefined?.[1] || q).replace(/[？?。.]/g, '');
      const hits = index.modules.flatMap(m => m.exports.filter(e => e.name === symbol || e.name.includes(symbol)).map(e => ({ mod: m.name, exp: e })));
      if (hits.length > 0) {
        console.log(drawWideBox(hits.map(h => `${C.accent(h.exp.name)} ${C.dim(h.exp.kind)}  ${C.dim('→')} ${C.accent(h.mod)}  ${C.muted(h.exp.signature?.substring(0, 60) || '')}`).join('\n'), { title: `符号 ${C.accent(symbol)}` }) + '\n');
      } else {
        console.log(`  ${C.dim('未找到符号: ' + symbol)}\n`);
      }

      // Also search call graph
      if (whoCalls && index.callGraph) {
        const callers = index.callGraph.filter(e => e.callee.includes(symbol));
        if (callers.length > 0) {
          console.log(drawWideBox(callers.slice(0, 8).map(e => `${C.accent(e.caller)} ${C.dim('L' + e.line)}  ${C.muted(e.callerFile)}`).join('\n'), { title: `谁调用了 ${C.accent(symbol)}` }) + '\n');
        } else {
          console.log(`  ${C.dim('调用图无记录')}\n`);
        }
      }
      return;
    }

    // Show what a file/module exports
    if (whatExports) {
      const target = whatExports[1];
      const mod = index.modules.find(m => m.name.includes(target) || m.files.some(f => f.includes(target)));
      if (mod) {
        const lines = mod.exports.slice(0, 15).map(e => `${C.accent(e.name)} ${C.dim(e.kind)} ${C.muted(e.signature?.substring(0, 50) || '')}`);
        console.log(drawWideBox(lines.join('\n'), { title: `模块 ${C.accent(mod.name)} 导出 (${mod.exports.length})` }) + '\n');
      } else {
        console.log(`  ${C.dim('未找到模块: ' + target)}\n`);
      }
      return;
    }

    // Show module dependencies
    if (depsOf) {
      const target = depsOf[1];
      const mod = index.modules.find(m => m.name.includes(target));
      if (mod) {
        const deps = index.dependencyGraph.get(mod.name) || [];
        console.log(drawWideBox(deps.length > 0 ? deps.map(d => C.accent(d)).join('\n') : '无依赖', { title: `模块 ${C.accent(mod.name)} 的依赖` }) + '\n');
      } else {
        console.log(`  ${C.dim('未找到模块: ' + target)}\n`);
      }
      return;
    }

    // Default: search all
    const symbolHits = index.modules.flatMap(m => m.exports.filter(e => e.name === q || e.name.toLowerCase().includes(q.toLowerCase())).map(e => ({ mod: m.name, exp: e })));
    if (symbolHits.length > 0) {
      console.log(drawWideBox(symbolHits.slice(0, 10).map(h => `${C.accent(h.exp.name)} ${C.dim(h.exp.kind)} ${C.dim('→')} ${C.accent(h.mod)}`).join('\n'), { title: `代码智能: ${C.accent(q)}` }) + '\n');
      // Also show callers if available
      if (index.callGraph) {
        const callers = index.callGraph.filter(e => e.callee.includes(q));
        if (callers.length > 0) {
          console.log(`  ${C.dim('调用者:')} ${callers.slice(0, 5).map(e => C.accent(e.caller.split('/').pop() || e.caller)).join(', ')}\n`);
        }
      }
    } else {
      console.log(`  ${C.dim('代码智能未找到匹配: ' + q)}\n  ${C.muted('试试 /intel <函数名> 或 <文件名>')}\n`);
    }
  } catch (err) {
    console.log(`  ${C.dim('代码智能不可用')}\n`);
  }
}

async function cmdContext(args: string): Promise<void> {
  try { const { listTasks } = await import('../core/task-engine.js'); const tasks = await listTasks(process.cwd()); if (tasks.length === 0) { console.log(`  ${C.dim('无任务')}\n`); return; } if (args) { const t = tasks.find(t2 => t2.id.startsWith(args)); if (t) console.log(drawWideBox('ID ' + C.accent(t.id) + '\n状态 ' + C.accent(t.status) + '\n描述 ' + t.description, { title: '任务' }) + '\n'); else console.log(`  ${C.dim('未找到')}\n`); } else console.log(`  任务数: ${C.accent(String(tasks.length))}\n`); } catch { console.log(`  ${C.dim('无法加载')}\n`); }
}

// /docs sub-commands in REPL
async function cmdDocsSlash(args: string): Promise<void> {
  if (!args) { console.log(`  ${C.dim('用法: /docs ask|summarize|review|rewrite|changelog <参数>')}\n`); return; }
  const parts = args.split(/\s+/);
  const sub = parts[0];
  const rest = parts.slice(1).join(' ');
  try {
    const config = await loadConfig(process.cwd());
    if (!config) { console.log(`  ${C.warn('!')} 项目未初始化\n`); return; }
    const { askDocs, summarizeDoc, reviewDoc, rewriteDoc, generateChangelog, readFileContent } = await import('../core/docs-generator.js');

    if (sub === 'ask' || sub === 'a') {
      if (!rest) { console.log(`  ${C.dim('用法: /docs ask 你的问题')}\n`); return; }
      console.log(`  ${C.primary('◉')} ${C.dim('查询文档中...')}`);
      const index = state.projectIndex as unknown as import('../types.js').ProjectIndex || { modules: [], identity: { language: 'unknown', framework: 'unknown', database: 'unknown', buildSystem: 'unknown', testFramework: 'unknown', runtime: 'node', languageVersion: 'unknown', deploymentType: 'unknown', packageManager: 'npm' } };
      const answer = await askDocs(process.cwd(), rest, index, { ai: config.ai });
      console.log(`\n  ${answer}\n`);
    } else if (sub === 'summarize' || sub === 's') {
      if (!rest) { console.log(`  ${C.dim('用法: /docs summarize <文件路径>')}\n`); return; }
      console.log(`  ${C.primary('◉')} ${C.dim('生成摘要...')}`);
      const content = await readFileContent(process.cwd(), rest);
      const summary = await summarizeDoc(content, { ai: config.ai });
      console.log(`\n  ${C.dim('─── ' + rest + ' ───')}\n  ${summary}\n`);
    } else if (sub === 'review' || sub === 'r') {
      if (!rest) { console.log(`  ${C.dim('用法: /docs review <文件路径>')}\n`); return; }
      console.log(`  ${C.primary('◉')} ${C.dim('审查文档...')}`);
      const content = await readFileContent(process.cwd(), rest);
      const issues = await reviewDoc(content, { ai: config.ai });
      console.log(`\n  ${C.accent('质量审查: ' + rest)}\n`);
      for (const issue of issues) {
        const icon = issue.severity === 'high' ? I.err : issue.severity === 'medium' ? I.warn : I.ok;
        console.log(`  ${icon} ${issue.section}: ${issue.description}`);
        if (issue.suggestion) console.log(`    ${C.dim('→ ' + issue.suggestion)}`);
      }
      console.log();
    } else if (sub === 'rewrite' || sub === 'w') {
      const forIdx = rest.indexOf('--for');
      const file = forIdx > 0 ? rest.slice(0, forIdx).trim() : rest;
      const audience = forIdx > 0 ? rest.slice(forIdx + 5).trim() : 'beginner';
      if (!file) { console.log(`  ${C.dim('用法: /docs rewrite <文件> --for beginner|developer|manager')}\n`); return; }
      console.log(`  ${C.primary('◉')} ${C.dim(`改写为 ${audience} 版本...`)}`);
      const content = await readFileContent(process.cwd(), file);
      const rewritten = await rewriteDoc(content, audience, { ai: config.ai });
      console.log(`\n  ${C.dim('─── ' + file + ' → ' + audience + ' ───')}\n  ${rewritten}\n`);
    } else if (sub === 'changelog' || sub === 'c') {
      console.log(`  ${C.primary('◉')} ${C.dim('生成 CHANGELOG...')}`);
      const changelog = await generateChangelog(process.cwd(), { ai: config.ai });
      console.log(`\n${changelog}\n`);
    } else {
      console.log(`  ${C.dim('用法: /docs ask|summarize|review|rewrite|changelog <参数>')}\n`);
    }
  } catch (err) { console.log(`  ${I.err} ${(err as Error).message}\n`); }
}












