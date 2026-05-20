// Extra coverage for src/core/memory/working-memory.ts
// Targets: mergeErrors (281-288), saveToDisk (313-323), loadFromDisk (326-332)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkingMemory } from '../src/core/memory/working-memory.js';

describe('WorkingMemory extra coverage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wm-test-'));
  });

  afterEach(async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /**/ }
  });

  // ── mergeErrors (lines 281-288): triggered by compress() when > 3 errors ──
  it('mergeErrors is triggered when compress() is called with 4+ errors', () => {
    const wm = new WorkingMemory();
    // Add 4 errors to exceed the <= 3 early-return check in mergeErrors
    wm.addError('Error 1: connection refused');
    wm.addError('Error 2: timeout exceeded');
    wm.addError('Error 3: file not found');
    wm.addError('Error 4: permission denied');

    // compress() calls mergeErrors() internally (line 177)
    const result = wm.compress();
    expect(typeof result.before).toBe('number');
    expect(typeof result.after).toBe('number');

    // After merging, a merged error layer should exist
    const errorLayers = wm.getByType('error');
    const hasMerged = errorLayers.some(l => l.content.includes('合并'));
    expect(hasMerged).toBe(true);
  });

  it('mergeErrors does NOT merge when exactly 3 errors (early return)', () => {
    const wm = new WorkingMemory();
    wm.addError('Error 1');
    wm.addError('Error 2');
    wm.addError('Error 3');

    // compress() calls mergeErrors() but returns early (length <= 3)
    wm.compress();
    const errorLayers = wm.getByType('error');
    const hasMerged = errorLayers.some(l => l.content.includes('合并'));
    expect(hasMerged).toBe(false);
  });

  // ── saveToDisk (lines 313-323) ──
  it('saveToDisk writes snapshot to disk and returns file path', async () => {
    const wm = new WorkingMemory();
    wm.setTask('task-123', 'Write authentication module');
    wm.addError('Failed to connect to DB');

    const filePath = await wm.saveToDisk(tmpDir);
    expect(typeof filePath).toBe('string');
    expect(filePath).toContain('wm-');
    expect(filePath).toContain('.json');
    expect(filePath).toContain('task-123');
  });

  // ── loadFromDisk (lines 326-332) ──
  it('loadFromDisk restores snapshot from saved file', async () => {
    const wm = new WorkingMemory();
    wm.setTask('restore-task', 'Implement login flow');
    wm.addReasoning('Read auth module first');
    wm.addConclusion('Auth uses JWT tokens');

    const filePath = await wm.saveToDisk(tmpDir);
    const restored = await WorkingMemory.loadFromDisk(filePath);

    expect(restored).toBeInstanceOf(WorkingMemory);
    const snap = restored.snapshot();
    expect(snap.taskId).toBe('restore-task');
    const taskLayers = restored.getByType('task');
    expect(taskLayers.length).toBeGreaterThan(0);
  });

  // ── saveToDisk + loadFromDisk roundtrip ──
  it('save and load roundtrip preserves errors and reasoning', async () => {
    const wm = new WorkingMemory();
    wm.setTask('full-task', 'Refactor database layer');
    wm.addError('SQL syntax error at line 42');
    wm.addReasoning('Found the issue in query builder');

    const filePath = await wm.saveToDisk(tmpDir);
    const restored = await WorkingMemory.loadFromDisk(filePath);

    const errorLayers = restored.getByType('error');
    const reasoningLayers = restored.getByType('reasoning');
    expect(errorLayers.length).toBeGreaterThan(0);
    expect(reasoningLayers.length).toBeGreaterThan(0);
  });

  // ── extractForEpisodic with summarizeChain ──
  it('extractForEpisodic returns structured summary with all fields', () => {
    const wm = new WorkingMemory();
    wm.setTask('episode-task', 'Add caching layer');
    wm.addError('Cache miss — key not found');
    wm.addConclusion('Used Redis for caching');
    wm.addReasoning('Analyzed cache patterns');

    const episodic = wm.extractForEpisodic();
    expect(episodic.taskId).toBe('episode-task');
    expect(episodic.errors.some(e => e.includes('Cache miss'))).toBe(true);
    expect(episodic.conclusions.some(c => c.includes('Redis'))).toBe(true);
    expect(typeof episodic.reasoningSummary).toBe('string');
  });
});
