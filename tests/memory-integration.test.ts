// Unit tests for src/core/memory/integration.ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  isMemoryActive,
  resetMemoryRuntime,
  getMemoryRuntime,
  onTaskCreated,
  onTaskProgress,
  onTaskError,
  onTaskCompleted,
  onUserFeedback,
  ingestUserInput,
  ingestShellOutput,
  ingestGitDiff,
  getMemoryContextForLLM,
  onVerifyComplete,
  detectAndRecordPreference,
} from '../src/core/memory/integration.js';

// Prevent real SQLite / file-system access; ensureMemoryStore always rejects
vi.mock('../src/core/memory/store.js', () => ({
  ensureMemoryStore: vi.fn().mockRejectedValue(new Error('mock: store unavailable')),
  resetMemoryStore: vi.fn(),
}));

const FAKE_ROOT = '/test/fake/root';

async function exhaustRetries(): Promise<void> {
  // Call 3 times so _initRetries (3) > MAX_INIT_RETRIES (2)
  for (let i = 0; i < 3; i++) {
    try { await getMemoryRuntime(FAKE_ROOT); } catch { /* expected */ }
  }
}

describe('memory/integration', () => {
  afterEach(async () => {
    await resetMemoryRuntime();
  });

  describe('isMemoryActive', () => {
    it('returns false when no runtime is active', () => {
      expect(isMemoryActive()).toBe(false);
    });
  });

  describe('resetMemoryRuntime', () => {
    it('resolves without error when no runtime is active', async () => {
      await expect(resetMemoryRuntime()).resolves.toBeUndefined();
      expect(isMemoryActive()).toBe(false);
    });

    it('resets initRetries so getMemoryRuntime can be attempted again', async () => {
      try { await getMemoryRuntime(FAKE_ROOT); } catch { /* expected */ }
      await resetMemoryRuntime();
      // After reset, should throw (not silently skip) because retries are 0 again
      await expect(getMemoryRuntime(FAKE_ROOT)).rejects.toThrow();
    });
  });

  describe('getMemoryRuntime', () => {
    it('throws when store initialization fails', async () => {
      await expect(getMemoryRuntime(FAKE_ROOT)).rejects.toThrow('mock: store unavailable');
    });
  });

  describe('hooks return early when retries are exhausted', () => {
    beforeEach(exhaustRetries);

    it('onTaskCreated returns silently', async () => {
      await expect(onTaskCreated(FAKE_ROOT, 'task-1', 'do work')).resolves.toBeUndefined();
    });

    it('onTaskProgress returns silently', async () => {
      await expect(onTaskProgress(FAKE_ROOT, 'task-1', 'step 1')).resolves.toBeUndefined();
    });

    it('onTaskError returns silently', async () => {
      await expect(onTaskError(FAKE_ROOT, 'task-1', new Error('test'))).resolves.toBeUndefined();
    });

    it('onTaskCompleted returns silently', async () => {
      await expect(onTaskCompleted(FAKE_ROOT, 'task-1', {})).resolves.toBeUndefined();
    });

    it('onUserFeedback returns silently', async () => {
      await expect(onUserFeedback(FAKE_ROOT, 'task-1', 'great')).resolves.toBeUndefined();
    });

    it('ingestUserInput returns silently', async () => {
      await expect(ingestUserInput(FAKE_ROOT, 'hello')).resolves.toBeUndefined();
    });

    it('ingestShellOutput returns silently (stdout)', async () => {
      await expect(ingestShellOutput(FAKE_ROOT, 'output text', false)).resolves.toBeUndefined();
    });

    it('ingestShellOutput returns silently (stderr)', async () => {
      await expect(ingestShellOutput(FAKE_ROOT, 'error output', true)).resolves.toBeUndefined();
    });

    it('ingestGitDiff returns silently', async () => {
      await expect(ingestGitDiff(FAKE_ROOT, 'diff --git a/x b/x')).resolves.toBeUndefined();
    });

    it('getMemoryContextForLLM returns empty string', async () => {
      const result = await getMemoryContextForLLM(FAKE_ROOT, 'some task');
      expect(result).toBe('');
    });

    it('onVerifyComplete returns silently', async () => {
      await expect(onVerifyComplete(FAKE_ROOT, 'task-1', true, 'tests pass')).resolves.toBeUndefined();
    });

    it('detectAndRecordPreference returns silently', async () => {
      await expect(detectAndRecordPreference(FAKE_ROOT, '用 camelCase 命名')).resolves.toBeUndefined();
    });
  });

  describe('hooks catch errors gracefully when retries not yet exhausted', () => {
    it('onTaskCreated swallows runtime init failure', async () => {
      await expect(onTaskCreated(FAKE_ROOT, 'task-1', 'test')).resolves.toBeUndefined();
    });

    it('onTaskProgress swallows runtime init failure', async () => {
      await expect(onTaskProgress(FAKE_ROOT, 'task-1', 'step')).resolves.toBeUndefined();
    });

    it('onTaskError swallows runtime init failure (Error)', async () => {
      await expect(onTaskError(FAKE_ROOT, 'task-1', new Error('boom'))).resolves.toBeUndefined();
    });

    it('onTaskError swallows runtime init failure (string)', async () => {
      await expect(onTaskError(FAKE_ROOT, 'task-1', 'string error')).resolves.toBeUndefined();
    });

    it('onTaskCompleted swallows runtime init failure', async () => {
      await expect(onTaskCompleted(FAKE_ROOT, 'task-1', { filesChanged: ['a.ts'], verifyPassed: true })).resolves.toBeUndefined();
    });

    it('onUserFeedback swallows runtime init failure', async () => {
      await expect(onUserFeedback(FAKE_ROOT, undefined, 'good work')).resolves.toBeUndefined();
    });

    it('getMemoryContextForLLM returns empty string on init failure', async () => {
      const result = await getMemoryContextForLLM(FAKE_ROOT, 'task description');
      expect(result).toBe('');
    });

    it('onVerifyComplete swallows runtime init failure', async () => {
      await expect(onVerifyComplete(FAKE_ROOT, 'task-1', false, 'tests failed')).resolves.toBeUndefined();
    });

    it('detectAndRecordPreference swallows runtime init failure', async () => {
      await expect(detectAndRecordPreference(FAKE_ROOT, '用单引号')).resolves.toBeUndefined();
    });

    it('ingestGitDiff swallows runtime init failure', async () => {
      await expect(ingestGitDiff(FAKE_ROOT, 'diff text')).resolves.toBeUndefined();
    });
  });
});
