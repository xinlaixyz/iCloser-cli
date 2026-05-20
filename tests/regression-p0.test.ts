/**
 * regression-p0.test.ts — four targeted regression tests for P0 fixes
 *
 * 1. Chinese input → English memory-match tokens
 * 2. writeFile rejects symlink-escape paths
 * 3. createCommit rejects sensitive files
 * 4. Task status persists to disk and survives a simulated restart (fresh loadTask)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ── helpers ──────────────────────────────────────────────────────────────────

const tmpRoots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'ic-regression-'));
  tmpRoots.push(d);
  return d;
}

afterAll(async () => {
  for (const r of tmpRoots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// ── 1. Chinese → English token expansion ─────────────────────────────────────

describe('extractMemoryMatchTokens — Chinese input expands to English aliases', () => {
  it('用户登录验证 → includes user / auth / login / token / session / verify', async () => {
    const { extractMemoryMatchTokens } = await import('../src/core/context.js');
    const tokens = extractMemoryMatchTokens('用户登录验证');

    // Group 1: /用户|登录/ matches → user, auth, login, token, session should all appear
    expect(tokens).toContain('user');
    expect(tokens).toContain('auth');
    expect(tokens).toContain('login');
    expect(tokens).toContain('token');
    expect(tokens).toContain('session');

    // Group 2: /验证/ matches /校验|验证|检查|审计/ → validate / verify appear
    expect(tokens).toContain('verify');
    expect(tokens).toContain('validate');
  });

  it('任务队列调度 → includes task / queue / schedule', async () => {
    const { extractMemoryMatchTokens } = await import('../src/core/context.js');
    const tokens = extractMemoryMatchTokens('任务队列调度');
    expect(tokens).toContain('task');
    expect(tokens).toContain('queue');
    expect(tokens).toContain('schedule');
  });

  it('returns an array (max 20 entries)', async () => {
    const { extractMemoryMatchTokens } = await import('../src/core/context.js');
    const tokens = extractMemoryMatchTokens('用户支付风控数据库测试任务上下文扫描安全报告前端部署容器监控文档分析修复重构生成');
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.length).toBeLessThanOrEqual(20);
  });
});

// ── 2. writeFile — symlink escape rejected ────────────────────────────────────

describe('writeFile — symlink escape protection', () => {
  it('throws "符号链接路径遍历拒绝" when a symlink points outside the root', async () => {
    const { writeFile } = await import('../src/utils/fs.js');

    const root = await makeDir();            // safe root
    const external = await makeDir();        // directory OUTSIDE the root
    const linkName = join(root, 'evil-link');

    // Create a symlink inside root that resolves to outside
    await symlink(external, linkName, 'junction');

    // Attempt to write through the symlink
    await expect(
      writeFile(join(linkName, 'payload.txt'), 'pwned', root)
    ).rejects.toThrow('符号链接路径遍历拒绝');
  });

  it('allows normal writes inside root (no symlink)', async () => {
    const { writeFile } = await import('../src/utils/fs.js');
    const root = await makeDir();
    await mkdir(join(root, 'sub'), { recursive: true });

    // Should not throw
    await expect(
      writeFile(join(root, 'sub', 'normal.txt'), 'hello', root)
    ).resolves.not.toThrow();
  });
});

// ── 3. createCommit — sensitive files rejected ────────────────────────────────

describe('createCommit — sensitive file guard', () => {
  it('returns false when .env is in the file list and sensitiveFiles includes .env', async () => {
    const { createCommit } = await import('../src/utils/git.js');
    const root = await makeDir();

    const result = createCommit(
      root,
      'test: should be rejected',
      ['.env'],
      { security: { sensitiveFiles: ['.env'] } }
    );

    expect(result).toBe(false);
  });

  it('returns false for glob patterns like *.pem', async () => {
    const { createCommit } = await import('../src/utils/git.js');
    const root = await makeDir();

    const result = createCommit(
      root,
      'test: key file',
      ['server.pem'],
      { security: { sensitiveFiles: ['*.pem'] } }
    );

    expect(result).toBe(false);
  });

  it('rejects a path-traversal file regardless of config', async () => {
    const { createCommit } = await import('../src/utils/git.js');
    const root = await makeDir();

    // ../outside.ts attempts to escape the root
    const result = createCommit(root, 'escape', ['../outside.ts']);
    expect(result).toBe(false);
  });
});

// ── 4. Task status persists across simulated restart ─────────────────────────

describe('persistTask / loadTask — disk round-trip', () => {
  it('loadTask reads the latest persisted status after mutation', async () => {
    const { createTask, persistTask, loadTask } = await import('../src/core/task-engine.js');
    const root = await makeDir();

    // Step 1: create task in memory (initial status is 'queued')
    const task = createTask('regression: persist test');
    expect(task.status).toBe('queued');

    // Step 2: persist the initial state
    await persistTask(root, task);

    // Step 3: mutate the task object (simulating work)
    task.status = 'completed';

    // Step 4: persist the updated state
    await persistTask(root, task);

    // Step 5: fresh load from disk — simulates a process restart
    const loaded = await loadTask(root, task.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(task.id);
    expect(loaded!.status).toBe('completed');
  });

  it('returns null for a task id that was never persisted', async () => {
    const { loadTask } = await import('../src/core/task-engine.js');
    const root = await makeDir();

    const loaded = await loadTask(root, 'nonexistent-task-id-xyz');
    expect(loaded).toBeNull();
  });
});
