// Memory Kernel v1.0 — Sensory Buffer Tests
import { describe, it, expect, beforeEach } from 'vitest';
import { SensoryBuffer } from '../../src/core/memory/sensory-buffer.js';

describe('SensoryBuffer', () => {
  let buffer: SensoryBuffer;

  beforeEach(() => {
    buffer = new SensoryBuffer({
      maxSize: 20,
      lowValueTTLms: 1000,
      mediumTTLms: 3000,
      highTTLms: 5000,
    });
  });

  it('ingests cli_input records', () => {
    const record = buffer.ingest('cli_input', 'ic t "修改钱包 UI"');
    expect(record.source).toBe('cli_input');
    expect(record.importance).toBe('medium'); // cli_input defaults to medium
    expect(record.isError).toBe(false);
  });

  it('marks stderr as error', () => {
    const record = buffer.ingest('shell_stderr', 'Error: file not found');
    expect(record.importance).toBe('high');
    expect(record.isError).toBe(true);
  });

  it('detects high-importance keywords', () => {
    const record = buffer.ingest('compile_log', 'FATAL: 致命错误: 数据丢失');
    expect(record.importance).toBe('high');
    expect(record.isError).toBe(true);
  });

  it('filters out noise', () => {
    buffer.ingest('shell_stdout', '[INFO] Starting server on port 3000');
    // Noise is returned but not stored
    const records = buffer.peek();
    expect(records.some(r => r.content.includes('Starting server'))).toBe(false);
  });

  it('filters empty content', () => {
    buffer.ingest('shell_stdout', '');
    const records = buffer.peek();
    expect(records.length).toBe(0);
  });

  it('detects duplicates', () => {
    buffer.ingest('cli_input', 'same command');
    const dup = buffer.ingest('cli_input', 'same command');
    expect(dup.isDuplicate).toBe(true);
  });

  it('drains and clears', () => {
    buffer.ingest('cli_input', 'test 1');
    buffer.ingest('cli_input', 'test 2');
    const drained = buffer.drain();
    expect(drained).toHaveLength(2);
    expect(buffer.peek()).toHaveLength(0);
  });

  it('drains only important records', () => {
    buffer.ingest('shell_stdout', 'build completed successfully');    // low (not noise)
    buffer.ingest('shell_stderr', 'Error: crash!');                   // high
    buffer.ingest('cli_input', 'user input command');                 // medium

    const important = buffer.drainImportant();
    expect(important).toHaveLength(1);
    expect(important[0].source).toBe('shell_stderr');

    const remaining = buffer.peek();
    expect(remaining).toHaveLength(2); // low stdout + medium cli_input
  });

  it('summarizes correctly', () => {
    buffer.ingest('cli_input', 'input');
    buffer.ingest('shell_stderr', 'error');

    const summary = buffer.summary();
    expect(summary.total).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.bySource.cli_input).toBe(1);
    expect(summary.bySource.shell_stderr).toBe(1);
  });

  it('expires stale low-value records', async () => {
    buffer.ingest('shell_stdout', 'low value message');
    expect(buffer.peek()).toHaveLength(1);

    await new Promise(resolve => setTimeout(resolve, 1200));

    const records = buffer.peek();
    expect(records).toHaveLength(0);
  });

  it('high-value records persist longer', async () => {
    buffer.ingest('shell_stderr', 'Error: critical failure');

    await new Promise(resolve => setTimeout(resolve, 1200));

    // High TTL is 5000ms, should still be there
    const records = buffer.peek();
    expect(records).toHaveLength(1);
  });

  it('respects maxSize', () => {
    const small = new SensoryBuffer({ maxSize: 5, lowValueTTLms: 5000 });
    for (let i = 0; i < 10; i++) {
      small.ingest('cli_input', `input ${i}`);
    }
    expect(small.peek()).toHaveLength(5);
  });

  it('gets by source', () => {
    buffer.ingest('cli_input', 'a');
    buffer.ingest('cli_input', 'b');
    buffer.ingest('shell_stderr', 'error');

    const cliRecords = buffer.getBySource('cli_input');
    expect(cliRecords).toHaveLength(2);

    const errors = buffer.getErrors();
    expect(errors).toHaveLength(1);
  });
});

// ── Working Memory ──

import { WorkingMemory } from '../../src/core/memory/working-memory.js';

describe('WorkingMemory', () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory({ maxTokens: 5000, warnThreshold: 0.7, criticalThreshold: 0.9 });
  });

  it('sets task description', () => {
    wm.setTask('task-001', '修改钱包首页 Swap UI');
    expect(wm.tokenCount).toBeGreaterThan(0);
    expect(wm.status).toBe('ok');
  });

  it('adds reasoning steps', () => {
    wm.addReasoning('读取 wallet/index.tsx');
    wm.addReasoning('分析 Swap 组件依赖');
    const chain = wm.getReasoningChain();
    expect(chain).toContain('wallet/index.tsx');
    expect(chain).toContain('Swap');
  });

  it('adds recall context', () => {
    wm.addRecall('[规则] 不要新增 API', 85);
    wm.addRecall('[历史] 上次 UI 修改导致崩溃', 70);

    const assembled = wm.assembleContext();
    expect(assembled).toContain('不要新增 API');
    expect(assembled).toContain('上次');
  });

  it('tracks errors', () => {
    wm.addError('TypeError: undefined is not an object');
    wm.addError('Build failed');

    const errors = wm.getErrorSummary();
    expect(errors).toContain('TypeError');
    expect(errors).toContain('Build failed');

    const summary = wm.layerSummary;
    expect(summary.error).toBe(2);
  });

  it('adds conclusions', () => {
    wm.addConclusion('修改成功，验证通过');
    const conclusions = wm.extractConclusions();
    expect(conclusions).toHaveLength(1);
    expect(conclusions[0]).toContain('验证');
  });

  it('snapshots and restores', () => {
    wm.setTask('t1', 'test task');
    wm.addReasoning('step 1');
    wm.addError('some error');

    const snap = wm.snapshot();
    expect(snap.layers.length).toBe(3);
    expect(snap.totalTokens).toBeGreaterThan(0);

    const wm2 = new WorkingMemory();
    wm2.restore(snap);
    expect(wm2.tokenCount).toBe(snap.totalTokens);
    expect(wm2.getErrorSummary()).toContain('some error');
  });

  it('compresses when over budget', () => {
    const tiny = new WorkingMemory({ maxTokens: 200, warnThreshold: 0.3, criticalThreshold: 0.5 });
    tiny.setTask('t', '填充内容 '.repeat(200)); // ~50+ tokens
    // Add many large reasoning steps to exceed budget
    for (let i = 0; i < 20; i++) {
      tiny.addReasoning('步骤分析 ' + i + ' 详细推理过程说明 '.repeat(50));
    }

    // Should at least be 'warn'
    expect(['warn', 'critical']).toContain(tiny.status);
    const before = tiny.tokenCount;
    tiny.compress();
    expect(tiny.tokenCount).toBeLessThanOrEqual(before);
  });

  it('extracts for episodic memory', () => {
    wm.setTask('task-123', 'some task');
    wm.addConclusion('结论1');
    wm.addConclusion('结论2');
    wm.addError('error1');
    wm.addReasoning('thinking');

    const extracted = wm.extractForEpisodic();
    expect(extracted.taskId).toBe('task-123');
    expect(extracted.conclusions).toHaveLength(2);
    expect(extracted.errors).toHaveLength(1);
    expect(extracted.reasoningSummary).toBeTruthy();
  });

  it('clears completely', () => {
    wm.setTask('t', 'desc');
    wm.clear();
    expect(wm.tokenCount).toBe(0);
    expect(wm.layerSummary).toEqual({});
  });

  it('warns at 70% usage', () => {
    const small = new WorkingMemory({ maxTokens: 200, warnThreshold: 0.3, criticalThreshold: 0.6 });
    small.setTask('t', '填充大量数据 '.repeat(100)); // enough to push towards threshold
    // Keep adding large content until we cross threshold
    let i = 0;
    while (small.status === 'ok' && i < 80) {
      small.addReasoning('步骤分析数据 '.repeat(30) + i++);
    }
    expect(['warn', 'critical']).toContain(small.status);
  });
});
