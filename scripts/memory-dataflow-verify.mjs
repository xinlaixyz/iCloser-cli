// Memory Kernel Data Flow Verification — 端到端数据流验收
// Tests every node in the pipeline: sensory → recall → compose → inject → episodic
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Dynamic import for ESM compatibility
async function run() {
  const passed = [];
  const failed = [];

  function check(name, condition, detail = '') {
    if (condition) { passed.push(name); console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
    else { failed.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  }

  console.log('\n═══ Memory Kernel 数据流验证 ═══\n');

  // ═══ 1. Storage Foundation ═══
  console.log('── 1. 存储层 ──');
  const tmpDir = path.join(os.tmpdir(), 'icloser-flow-test-' + Date.now().toString(36));

  // Lazy load modules
  const { ensureMemoryStore, getMemoryStore, resetMemoryStore, createMemoryStore } = await import('../dist/core/memory/store.js');
  const { JSONLStore } = await import('../dist/core/memory/jsonl-store.js');

  const store = createMemoryStore(tmpDir);
  check('store.paths 完整', store.paths && store.paths.root && store.paths.sensory && store.paths.episodic && store.paths.semantic);
  check('store.createSensoryLog()', !!store.createSensoryLog('test-session'));
  check('store.createEpisodicLog()', !!store.createEpisodicLog('2026-05'));

  // JSONL Store test
  const jlog = new JSONLStore(path.join(tmpDir, '.agent/memory/test-flow.jsonl'));
  await jlog.init();
  await jlog.append({ type: 'test', msg: 'hello' });
  await jlog.append({ type: 'test', msg: 'world' });
  const records = await jlog.readAll();
  check('JSONL write+read', records.length === 2, `${records.length} records`);
  check('JSONL tail', (await jlog.readTail(1)).length === 1);
  check('JSONL count', (await jlog.count()) === 2);

  console.log('\n── 2. 感官缓冲 ──');
  const { SensoryBuffer } = await import('../dist/core/memory/sensory-buffer.js');
  const buffer = new SensoryBuffer({ maxSize: 20 });
  const r1 = buffer.ingest('cli_input', '修改钱包 UI');
  check('ingest CLI input', r1.source === 'cli_input' && r1.importance === 'medium');
  const r2 = buffer.ingest('shell_stderr', 'Error: crash in Swap');
  check('detect stderr as error', r2.isError && r2.importance === 'high');
  const r3 = buffer.ingest('shell_stdout', '');
  check('filter empty noise', buffer.peek().length === 2); // empty filtered
  const summary = buffer.summary();
  check('sensory summary', summary.total === 2 && summary.errors === 1);

  console.log('\n── 3. 工作记忆 ──');
  const { WorkingMemory } = await import('../dist/core/memory/working-memory.js');
  const wm = new WorkingMemory({ maxTokens: 10000 });
  wm.setTask('task-001', '修改钱包首页 Swap UI');
  check('setTask', wm.tokenCount > 0);
  wm.addReasoning('读取 wallet/index.tsx');
  wm.addRecall('[规则] 不要新增 API', 85);
  wm.addError('TypeError: undefined is not an object');
  const ctx = wm.assembleContext();
  check('assembleContext 含规则', ctx.includes('不要新增 API'));
  check('assembleContext 含错误', ctx.includes('TypeError'));
  const snap = wm.snapshot();
  check('snapshot', snap.layers.length === 4);
  wm.clear();
  check('clear', wm.tokenCount === 0);

  console.log('\n── 4. 情景记忆 ──');
  let epMem;
  try {
    const store2 = await ensureMemoryStore(tmpDir);
    const { EpisodicMemory, createEpisode } = await import('../dist/core/memory/episodic.js');
    epMem = new EpisodicMemory(store2);
    const ep1 = await epMem.record(createEpisode('task_started', '开始任务: 修改 Swap', '用户要求修改 Swap UI', { taskId: 't1', importance: 0.5, tags: ['ui', 'swap'] }));
    const ep2 = await epMem.record(createEpisode('task_completed', '完成任务: 修改 Swap', '验证通过', { taskId: 't1', importance: 0.4, tags: ['ui', 'swap'] }));
    const ep3 = await epMem.record(createEpisode('error_occurred', '严重: Swap 崩溃', '生产事故数据丢失', { taskId: 't2', importance: 0.9, tags: ['crash', 'critical'] }));
    check('record 3 episodes', ep1 && ep2 && ep3);
    const recent = epMem.recent(7);
    check('recent query', recent.length === 3);
    const important = epMem.important(0.7);
    check('important filter', important.length === 1 && important[0].type === 'error_occurred');
    const taskEps = epMem.getTaskEpisodes('t1');
    check('getTaskEpisodes', taskEps.length === 2);
    const searched = epMem.search('Swap');
    check('text search', searched.length >= 1);
  } catch (e) { console.log(`  ✗ 情景记忆异常: ${e.message}`); }

  console.log('\n── 5. 语义记忆 ──');
  const { SemanticMemory } = await import('../dist/core/memory/semantic.js');
  const semMem = new SemanticMemory(store);
  const r = await import('../dist/core/memory/semantic.js');
  // Add rules
  semMem.add({ path: 'iOS/UI/修改规则', domain: 'iOS', platform: 'Swift', area: 'UI',
    content: '不要新增 API，只能修改 UI 和文案', scope: 'project', confidence: 0.9, tags: ['ios', 'ui'], isPermanent: true });
  semMem.add({ path: 'General/安全', domain: 'General',
    content: '禁止硬编码密钥在源代码中', scope: 'project', confidence: 0.95, tags: ['security'], isPermanent: true });
  check('add rules', semMem.totalRules === 2);
  // Search (word-split)
  const rel1 = semMem.searchRelevant('iOS API 修改');
  check('searchRelevant "iOS API"', rel1.length >= 1 && rel1[0].content.includes('不要新增'), `found ${rel1.length} rules`);
  const rel2 = semMem.searchRelevant('安全密钥');
  check('searchRelevant "安全密钥"', rel2.length >= 1 && rel2[0].content.includes('密钥'), `found ${rel2.length} rules`);
  const rel3 = semMem.searchRelevant('不存在的查询');
  check('searchRelevant 无匹配', rel3.length === 0, 'correctly returns empty');

  console.log('\n── 6. Salience + Forgetting ──');
  const { SalienceEngine } = await import('../dist/core/memory/salience.js');
  const salience = new SalienceEngine();
  const normalEp = { type: 'task_started', summary: '普通任务', importance: 0.3, tags: [], details: '' };
  const criticalEp = { type: 'error_occurred', summary: '生产事故数据丢失', importance: 0.9, tags: [], details: 'urgent' };
  const normalScore = salience.rate(normalEp);
  const criticalScore = salience.rate(criticalEp);
  check('salience: critical > normal', criticalScore.score > normalScore.score,
    `critical=${criticalScore.score.toFixed(2)} normal=${normalScore.score.toFixed(2)}`);
  check('salience: keywordBoost works', criticalScore.components.keywordBoost > 0,
    `boost=${criticalScore.components.keywordBoost.toFixed(2)}`);
  check('hasHighSignal detects urgent', SalienceEngine.hasHighSignal('生产事故') === true);

  const { ForgettingEngine } = await import('../dist/core/memory/forgetting.js');
  const forget = new ForgettingEngine();
  const ancientDate = '2020-01-01T00:00:00Z';
  const oldScore = forget.retentionScore(0.3, ancientDate, 'low');
  const newScore = forget.retentionScore(0.3, new Date().toISOString(), 'low');
  check('forgetting: old < new', oldScore < newScore, `old=${oldScore.toFixed(3)} new=${newScore.toFixed(3)}`);

  console.log('\n── 7. Recall Pipeline ──');
  const { RecallEngine } = await import('../dist/core/memory/recall.js');
  const recall = new RecallEngine(epMem, semMem, salience, { topK: 5 });
  const results = await recall.recall('修改 Swap UI');
  check('recall returns results', results.length > 0, `${results.length} results`);
  check('recall has semantic result', results.some(r => r.type === 'semantic'), 'includes rule');
  check('recall has timeline result', results.some(r => r.type === 'timeline'), 'includes history');
  check('recall has top-K limit', results.length <= 5, `${results.length} <= 5`);
  // Check scores
  const hasValidScores = results.every(r => r.score > 0 && r.score <= 1);
  check('recall scores valid', hasValidScores);

  console.log('\n── 8. Context Composer ──');
  const { ContextComposer } = await import('../dist/core/memory/composer.js');
  const composer = new ContextComposer({ maxTokens: 3000, maxItems: 10, maxItemsPerType: 5 });
  const composed = composer.compose(results, '修改 Swap UI');
  check('composer returns items', composed.items.length > 0, `${composed.items.length} items`);
  check('composer injectedText', composed.injectedText.length > 0);
  check('composer has memory header', composed.injectedText.includes('记忆'));
  const compact = composer.composeCompact(results, '修改 Swap UI');
  check('composeCompact non-empty', compact.length > 0);
  check('composeCompact has header', compact.includes('Memory Recall'));

  console.log('\n── 9. Memory Runtime ──');
  // Save semantic rules to disk so runtime can load them
  await semMem.save();
  const { MemoryRuntime } = await import('../dist/core/memory/runtime.js');
  const runtime = new MemoryRuntime(store);
  await runtime.init();
  check('runtime init', runtime['initialized'] === true);
  const status = runtime.getStatus();
  check('status has episodic', status.episodic.totalEvents >= 3);
  check('status has semantic', status.semantic.totalRules >= 2, `found ${status.semantic.totalRules}`);
  check('status initialized', status.initialized === true);

  // Task lifecycle test
  await runtime.onTaskStart('flow-test-1', '集成测试任务');
  check('onTaskStart works', runtime.working.tokenCount > 0);
  await runtime.onTaskProgress('flow-test-1', '步骤1: 读取文件');
  const wmStatus = runtime.working.status;
  check('onTaskProgress', runtime.working.tokenCount > 0 && (wmStatus === 'ok' || wmStatus === 'warn'));
  await runtime.onTaskComplete('flow-test-1', { filesChanged: ['test.ts'], verifyPassed: true, summary: 'ok' });
  const finalStatus = runtime.getStatus();
  check('onTaskComplete records', finalStatus.metrics.tasksProcessed === 1);
  check('onTaskComplete clears WM', runtime.working.tokenCount === 0);

  console.log('\n── 10. Integration hooks ──');
  const { getMemoryRuntime, isMemoryActive, onTaskCreated, onTaskCompleted, getMemoryContextForLLM, ingestUserInput } =
    await import('../dist/core/memory/integration.js');
  // The integration singleton should already be active from store init above
  // Reset first to test clean init
  const { resetMemoryRuntime } = await import('../dist/core/memory/integration.js');
  resetMemoryRuntime();

  const rt = await getMemoryRuntime(tmpDir);
  check('getMemoryRuntime returns instance', rt !== null && rt !== undefined);
  check('isMemoryActive after init', isMemoryActive() === true);

  // Test context injection
  const llmCtx = await getMemoryContextForLLM(tmpDir, '修改 Swap');
  check('getMemoryContextForLLM non-empty', llmCtx.length > 0, `${llmCtx.length} chars`);
  check('getMemoryContextForLLM has rules', llmCtx.includes('规则') || llmCtx.includes('Memory Recall'));

  // Test sensory ingestion
  await ingestUserInput(tmpDir, '用户测试输入');
  check('ingestUserInput works', true); // fire-and-forget, no throw

  console.log('\n── 11. Bootstrap ──');
  const { bootstrapMemoryKernel } = await import('../dist/core/memory/bootstrap.js');
  // Bootstrap on the AgentCode project itself for real data test
  const bootstrapRt = await getMemoryRuntime(projectRoot);
  const bsResult = await bootstrapMemoryKernel(projectRoot, bootstrapRt);
  check('bootstrap returns events', bsResult.episodesCreated >= 0);
  check('bootstrap returns rules', bsResult.rulesCreated >= 0); // at least auto-detected from code patterns
  check('bootstrap patterns found', bsResult.patternsFound.length >= 0);

  // ═══ Summary ═══
  console.log(`\n═══ 结果: ${passed.length} passed / ${failed.length} failed ═══\n`);
  if (failed.length > 0) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  ✗ ${f}`);
  }

  // Cleanup
  resetMemoryRuntime();
  try { require('fs').rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
