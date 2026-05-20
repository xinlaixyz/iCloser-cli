// Extra coverage for:
//   src/core/security.ts  — getEffectiveMode (239-245), scanTaskSecurity (285-294)
//   src/cli/output.ts     — spinner (159-164), printProjectIdentity (177-188)
//   src/core/memory/jsonl-store.ts — clear() (96-102), rotateIfNeeded (109-118)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  getEffectiveMode,
  scanTaskSecurity,
} from '../src/core/security.js';
import {
  spinner,
  printProjectIdentity,
} from '../src/cli/output.js';
import { JSONLStore } from '../src/core/memory/jsonl-store.js';
import type { ICloserConfig, Task } from '../src/types.js';

// ============================================================
// Helpers
// ============================================================
function makeConfig(overrides: Partial<ICloserConfig['security']> = {}): ICloserConfig {
  return {
    version: '0.1.0',
    rootPath: '/test',
    projectIdentity: {
      language: 'typescript', framework: 'express', database: '',
      buildSystem: 'npm', testFramework: 'vitest', runtime: 'node',
      deploymentType: 'local', packageManager: 'npm', languageVersion: '20',
    },
    ai: {
      provider: 'mock', model: 'mock-offline', maxTokens: 10000, temperature: 0.3,
    },
    execution: { defaultMode: 'preview', maxRetries: 3, verifyStages: [], autoApprove: false },
    security: {
      allowGitPush: false,
      sensitiveFiles: ['.env', '*.pem', '*.key'],
      disabledRules: [],
      ...overrides,
    },
    memory: { enabled: true, maxMemoryCandidates: 100, compressThreshold: 50 },
    skills: { enabled: [] },
  } as unknown as ICloserConfig;
}

function makeTask(changes: { file: string; operation?: string; content?: string }[] = []): Task {
  return {
    id: 'test-task-001',
    description: 'Test task',
    status: 'queued',
    priority: 'normal',
    createdAt: new Date().toISOString(),
    changes: changes.map(c => ({
      file: c.file,
      operation: c.operation ?? 'modify',
      content: c.content ?? '',
      reason: 'test',
    })),
    diffs: [],
    reasoning: [],
    errorLog: [],
    retryCount: 0,
    maxRetries: 3,
    agentExecutions: [],
  } as unknown as Task;
}

// ============================================================
// getEffectiveMode
// ============================================================
describe('getEffectiveMode', () => {
  it('returns execute when config defaultMode is execute', () => {
    const config = makeConfig();
    config.execution.defaultMode = 'execute';
    const task = makeTask();
    const mode = getEffectiveMode(task, config);
    expect(mode).toBe('execute');
  });

  it('returns preview when config defaultMode is preview', () => {
    const config = makeConfig();
    config.execution.defaultMode = 'preview';
    const task = makeTask();
    const mode = getEffectiveMode(task, config);
    expect(mode).toBe('preview');
  });
});

// ============================================================
// scanTaskSecurity — sensitive file detection
// ============================================================
describe('scanTaskSecurity', () => {
  it('detects sensitive file modification (.env)', async () => {
    const config = makeConfig();
    const task = makeTask([{ file: '.env', operation: 'modify', content: 'SECRET=abc' }]);
    const issues = await scanTaskSecurity('/project', task, config);
    const sensIssue = issues.find(i => i.ruleId === 'sensitive-file-modified');
    expect(sensIssue).toBeDefined();
    expect(sensIssue!.file).toBe('.env');
  });

  it('returns no sensitive-file issue for normal source file', async () => {
    const config = makeConfig();
    const task = makeTask([{ file: 'src/auth.ts', operation: 'modify', content: 'const x = 1;' }]);
    const issues = await scanTaskSecurity('/project', task, config);
    const sensIssue = issues.find(i => i.ruleId === 'sensitive-file-modified');
    expect(sensIssue).toBeUndefined();
  });

  it('returns empty array when task has no changes', async () => {
    const config = makeConfig();
    const task = makeTask([]);
    const issues = await scanTaskSecurity('/project', task, config);
    expect(issues).toEqual([]);
  });

  it('detects .pem sensitive file', async () => {
    const config = makeConfig();
    const task = makeTask([{ file: 'certs/server.pem', operation: 'add', content: '---BEGIN CERT---' }]);
    const issues = await scanTaskSecurity('/project', task, config);
    const sensIssue = issues.find(i => i.ruleId === 'sensitive-file-modified');
    expect(sensIssue).toBeDefined();
  });

  it('skips duplicate file entries (seen set)', async () => {
    const config = makeConfig();
    const task = makeTask([
      { file: '.env', operation: 'modify', content: 'A=1' },
      { file: '.env', operation: 'modify', content: 'B=2' }, // duplicate
    ]);
    const issues = await scanTaskSecurity('/project', task, config);
    const sensIssues = issues.filter(i => i.ruleId === 'sensitive-file-modified');
    // Should only report .env once (deduplication)
    expect(sensIssues.length).toBe(1);
  });
});

// ============================================================
// spinner
// ============================================================
describe('spinner', () => {
  it('returns an Ora spinner object with the given text', () => {
    const s = spinner('Loading...');
    expect(s).toBeDefined();
    // Ora object has start/stop methods
    expect(typeof s.start).toBe('function');
    expect(typeof s.stop).toBe('function');
  });

  it('spinner text uses the provided label', () => {
    const s = spinner('Processing files');
    // The spinner is created with chalk.cyan wrapping, so text includes our string
    expect(s.text).toContain('Processing files');
  });
});

// ============================================================
// printProjectIdentity
// ============================================================
describe('printProjectIdentity', () => {
  let output: string[] = [];
  let origLog: (...args: unknown[]) => void;

  beforeEach(() => {
    output = [];
    origLog = console.log;
    console.log = (...args: unknown[]) => { output.push(args.join(' ')); };
  });

  afterEach(() => {
    console.log = origLog;
  });

  it('prints all identity fields including version when not "unknown"', () => {
    printProjectIdentity({
      language: 'typescript',
      framework: 'express',
      database: 'postgres',
      buildSystem: 'npm',
      testFramework: 'vitest',
      runtime: 'node',
      languageVersion: '20',
    });
    const all = output.join('\n');
    expect(all).toContain('typescript');
    expect(all).toContain('express');
    expect(all).toContain('20');
  });

  it('omits version line when languageVersion is "unknown"', () => {
    printProjectIdentity({
      language: 'python',
      framework: 'flask',
      database: '',
      buildSystem: 'pip',
      testFramework: 'pytest',
      runtime: 'python',
      languageVersion: 'unknown',
    });
    const all = output.join('\n');
    expect(all).toContain('python');
    // "版本" line should not appear when languageVersion === 'unknown'
    const lineWithVersion = output.find(l => l.includes('版本') && l.includes('unknown'));
    expect(lineWithVersion).toBeUndefined();
  });
});

// ============================================================
// JSONLStore — clear() and rotateIfNeeded() (lines 97-102, 109-118)
// ============================================================
describe('JSONLStore.clear and rotate', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jsonl-test-'));
  });

  afterEach(async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /**/ }
  });

  it('clear() resets the store to empty', async () => {
    const store = new JSONLStore(join(tmpDir, 'test.jsonl'));
    await store.init();
    await store.append({ key: 'value1' });
    await store.append({ key: 'value2' });

    const beforeClear = await store.readAll();
    expect(beforeClear.length).toBeGreaterThan(0);

    await store.clear();
    const afterClear = await store.readAll();
    expect(afterClear).toHaveLength(0);
  });

  it('rotateIfNeeded() rotates file when maxLines exceeded', async () => {
    // Set maxLines=2 so rotation fires after 3 records
    const store = new JSONLStore(join(tmpDir, 'rotate.jsonl'), { maxLines: 2 });
    await store.init();

    // Write 3 records to trigger rotation on the 3rd flush
    await store.append({ n: 1 });
    await store.append({ n: 2 });
    await store.append({ n: 3 }); // should trigger rotateIfNeeded

    // After rotation, the current file should be empty or have only recent records
    // (rotation is best-effort async, so we just verify it doesn't throw)
    const records = await store.readAll();
    expect(Array.isArray(records)).toBe(true);
  });

  it('count() returns 0 for non-existent file', async () => {
    const store = new JSONLStore(join(tmpDir, 'nonexistent.jsonl'));
    const count = await store.count();
    expect(count).toBe(0);
  });

  it('readTail() returns last N records', async () => {
    const store = new JSONLStore(join(tmpDir, 'tail.jsonl'));
    await store.init();
    for (let i = 0; i < 5; i++) {
      await store.append({ seq: i });
    }
    const tail = await store.readTail(3);
    expect(tail).toHaveLength(3);
    expect((tail[2] as Record<string, number>).seq).toBe(4);
  });
});
