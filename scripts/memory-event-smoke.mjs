// S4.1.1 User Input Event Smoke
// Verifies every user input enters memory event stream and sensitive content is not leaked.
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');
const FAKE_KEY = 'sk-fake-memory-smoke-key-abcdef123456';

function log(msg) {
  process.stdout.write(`\n[memory-smoke] ${msg}\n`);
}

function assert(condition, desc) {
  if (condition) {
    log(`PASS: ${desc}`);
  } else {
    log(`FAIL: ${desc}`);
    throw new Error(`Assertion failed: ${desc}`);
  }
}

function run(cwd, args, opts = {}) {
  const label = args.join(' ');
  log(`run: ic ${label}`);
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf-8',
    timeout: opts.timeout || 120000,
    shell: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr && !opts.ignoreStderr) process.stderr.write(result.stderr);
  if (result.status !== 0 && !opts.allowNonZero) {
    throw new Error(`ic ${label} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

async function main() {
  // Build first
  log('building...');
  if (process.platform === 'win32') {
    spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
  } else {
    spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
  }
  if (!existsSync(cli)) throw new Error('dist/index.js not found after build.');

  const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-memory-smoke-'));
  const home = join(tempRoot, 'home');
  const project = join(tempRoot, 'project');

  // Ensure no real API key leaks, force mock provider
  const env = {
    ...process.env,
    ICLOSER_HOME: home,
    ICLOSER_AI_PROVIDER: 'mock',
    HOME: home,
    USERPROFILE: home,
  };
  delete env.DEEPSEEK_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.QWEN_API_KEY;
  delete env.DASHSCOPE_API_KEY;

  try {
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      name: 'memory-smoke-test',
      scripts: { build: 'node -e "1"', lint: 'node -e "1"', test: 'node -e "1"' },
    }), 'utf-8');
    // Pre-create a notes.txt so ic t has a real target
    await writeFile(join(project, 'notes.txt'), 'smoke notes placeholder\n', 'utf-8');

    // ═══════════════════════════════════════════════════════════
    // STEP 1: init project
    // ═══════════════════════════════════════════════════════════
    run(project, ['init', '--force'], { env });
    assert(existsSync(join(project, '.icloser')), '.icloser directory exists after init');

    // ═══════════════════════════════════════════════════════════
    // STEP 2: run ic t --go (generates task-description event)
    // ═══════════════════════════════════════════════════════════
    run(project, ['t', '修改 notes.txt 添加 memory smoke 标记', '--go'], { env, timeout: 180000 });

    // ═══════════════════════════════════════════════════════════
    // STEP 3: run ic rule (generates rule event)
    // ═══════════════════════════════════════════════════════════
    run(project, ['rule', '以后登录相关任务不要直接修改数据库 schema'], { env });

    // ═══════════════════════════════════════════════════════════
    // STEP 4: run ic setup --key <fake> (generates api-key event)
    // ═══════════════════════════════════════════════════════════
    run(project, ['setup', '--provider', 'deepseek', '--key', FAKE_KEY], { env });

    // ═══════════════════════════════════════════════════════════
    // Verify input-events.jsonl
    // ═══════════════════════════════════════════════════════════
    const eventsPath = join(project, '.icloser', 'input-events.jsonl');
    assert(existsSync(eventsPath), 'input-events.jsonl exists');

    const raw = await readFile(eventsPath, 'utf-8');
    const events = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);

    log(`Found ${events.length} input events in JSONL`);
    assert(events.length >= 2, `at least 2 input events (got ${events.length})`);

    // ═══════════════════════════════════════════════════════════
    // Verify event kinds
    // ═══════════════════════════════════════════════════════════
    const kinds = events.map(e => e.kind);
    log(`Event kinds: ${kinds.join(', ')}`);
    assert(kinds.includes('task-description'), 'contains task-description event');
    assert(kinds.includes('rule'), 'contains rule event');

    // ═══════════════════════════════════════════════════════════
    // Verify metadata fields on each event
    // ═══════════════════════════════════════════════════════════
    for (const event of events) {
      const meta = event.metadata;
      assert(meta && typeof meta === 'object', `event ${event.id} has metadata`);
      assert(meta.source === 'user', `event ${event.id} metadata.source=user (got ${meta.source})`);
      assert(meta.reviewStatus === 'draft', `event ${event.id} metadata.reviewStatus=draft (got ${meta.reviewStatus})`);
      // compressionLevel may vary by kind; task-description and rule should be 'raw'
      if (event.kind === 'task-description' || event.kind === 'rule') {
        assert(
          meta.compressionLevel === 'raw' || meta.compressionLevel === 'rule',
          `event ${event.id} compressionLevel is raw/rule (got ${meta.compressionLevel})`
        );
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Verify NO plaintext API key in JSONL
    // ═══════════════════════════════════════════════════════════
    assert(!raw.includes(FAKE_KEY), 'JSONL does not contain plaintext fake API key');
    // Check for common real key patterns
    const keyPattern = /sk-[a-zA-Z0-9_-]{20,}/;
    // The FAKE_KEY is 35 chars and should be masked
    const keyMatches = raw.match(keyPattern);
    if (keyMatches) {
      // Only the masked prefix may appear: sk-1... or sk-f...
      for (const m of keyMatches) {
        assert(m.length < 20, `key-like token in JSONL is too short to be real: ${m.substring(0, 20)}`);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Verify events are parseable via loadUserInputEvents
    // ═══════════════════════════════════════════════════════════
    const { loadUserInputEvents } = await import('../dist/core/memory.js');
    const loaded = await loadUserInputEvents(project);
    log(`loadUserInputEvents returned ${loaded.length} events`);
    assert(loaded.length === events.length, 'loadUserInputEvents count matches JSONL line count');
    for (const e of loaded) {
      assert(typeof e.id === 'string', `loaded event has id`);
      assert(typeof e.kind === 'string', `loaded event has kind`);
      assert(typeof e.content === 'string', `loaded event has content`);
    }

    // ═══════════════════════════════════════════════════════════
    // Verify auto memory candidates are visible without mutation
    // ═══════════════════════════════════════════════════════════
    const memoryRaw = await readFile(join(project, '.icloser', 'memory.json'), 'utf-8');
    const memory = JSON.parse(memoryRaw);
    const candidates = Array.isArray(memory.memoryCandidates) ? memory.memoryCandidates : [];
    log(`Found ${candidates.length} memory candidates`);
    assert(candidates.length >= 1, 'memory candidates are generated from user inputs');
    assert(
      candidates.some(c => c.reviewStatus === 'proposed' && c.suggestedAction === 'ask-now'),
      'high-risk rule becomes a proposed ask-now candidate'
    );

    const candidateOutput = run(project, ['mem', 'candidates'], { env });
    assert(candidateOutput.includes('记忆处理'), 'ic mem candidates prints memory processing summary');
    assert(candidateOutput.includes('需要确认') || candidateOutput.includes('待确认'), 'ic mem candidates shows confirmation state');
    assert(!candidateOutput.includes(FAKE_KEY), 'ic mem candidates does not leak plaintext API key');

    const reviewOutput = run(project, ['mem', 'review'], { env });
    assert(reviewOutput.includes('需要确认的记忆'), 'ic mem review shows beginner review panel');
    assert(reviewOutput.includes('ic mem approve 1'), 'ic mem review suggests numeric approve command');
    assert(reviewOutput.includes('ic mem reject 1'), 'ic mem review suggests numeric reject command');

    const approveOutput = run(project, ['mem', 'approve', '1'], { env });
    assert(approveOutput.includes('已保存到项目记忆'), 'ic mem approve 1 approves the first pending candidate');

    const afterApproveOutput = run(project, ['mem', 'candidates'], { env });
    assert(afterApproveOutput.includes('自动保存: 1 条'), 'ic mem candidates reflects approved candidate count');

    const { createTask } = await import('../dist/core/task-engine.js');
    const { assembleContextFromProject } = await import('../dist/core/context.js');
    const context = await assembleContextFromProject(
      project,
      createTask('继续修改 notes.txt 添加 memory smoke 标记'),
      { maxTokens: 12000 }
    );
    assert(context.relevantMemory.includes('已确认可复用记忆'), 'approved memory candidate enters relevant context');
    assert(context.relevantMemory.includes('memory smoke 标记'), 'approved template summary is visible in context');

    // ═══════════════════════════════════════════════════════════
    // Verify audit events (S4.4)
    // ═══════════════════════════════════════════════════════════
    const auditPath = join(project, '.icloser', 'audit', 'events.jsonl');
    assert(existsSync(auditPath), 'audit events.jsonl exists');

    const auditRaw = await readFile(auditPath, 'utf-8');
    const auditEvents = auditRaw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);

    log(`Found ${auditEvents.length} audit events`);
    assert(auditEvents.length >= 5, `at least 5 audit events (got ${auditEvents.length})`);

    const auditActions = auditEvents.map(e => e.action);
    log(`Audit actions: ${auditActions.join(', ')}`);
    assert(auditActions.includes('task-created'), 'audit contains task-created');
    assert(auditActions.includes('file-written'), 'audit contains file-written');
    assert(auditActions.includes('verify-run'), 'audit contains verify-run');
    assert(auditActions.includes('report-generated'), 'audit contains report-generated');
    assert(auditActions.includes('memory-updated'), 'audit contains memory-updated');

    // Verify no API key in audit
    assert(!auditRaw.includes(FAKE_KEY), 'audit JSONL does not contain plaintext fake API key');

    // Verify audit events have required fields
    for (const e of auditEvents) {
      assert(typeof e.id === 'string', `audit event ${e.id} has id`);
      assert(typeof e.actor === 'string', `audit event ${e.id} has actor`);
      assert(typeof e.action === 'string', `audit event ${e.id} has action`);
      assert(typeof e.target === 'string', `audit event ${e.id} has target`);
      assert(typeof e.result === 'string', `audit event ${e.id} has result`);
    }

    // Verify ic audit CLI works
    const auditCliOutput = run(project, ['audit'], { env });
    assert(auditCliOutput.includes('审计日志') || auditCliOutput.includes('audit'), 'ic audit shows audit log header');
    assert(!auditCliOutput.includes(FAKE_KEY), 'ic audit does not leak plaintext API key');

    log(`\nALL SMOKE CHECKS PASSED (${events.length} input events, ${auditEvents.length} audit events)`);
    log(`workspace: ${tempRoot}`);

  } finally {
    if (process.env.ICLOSER_KEEP_MEMORY_SMOKE !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  process.stderr.write(`\n[memory-smoke] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
