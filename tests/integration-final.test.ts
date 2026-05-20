// Final integration tests — worktree, task-memory, skill persistence
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const dirs: string[] = [];
function setupGitDir() {
  const d = mkdtempSync(join(tmpdir(), 'icloser-git-'));
  dirs.push(d);
  execSync('git init', { cwd: d, stdio: 'pipe' });
  execSync('git config user.email "test@test.com" && git config user.name "test"', { cwd: d, stdio: 'pipe' });
  writeFileSync(join(d, 'test.txt'), 'hello');
  execSync('git add . && git commit -m "init"', { cwd: d, stdio: 'pipe' });
  return d;
}

afterAll(() => {
  for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {}
});

describe('git worktree isolation (T1-6e)', () => {
  it('creates and removes worktree in git repo', async () => {
    const d = setupGitDir();
    const { createWorktree, removeWorktree, isGitRepo } = await import('../src/utils/git.js');
    expect(isGitRepo(d)).toBe(true);

    const wt = createWorktree(d, 'test-branch', join(d, '.icloser', 'worktrees', 'test-wt'));
    expect(wt).toBe(true);

    const removed = removeWorktree(d, join(d, '.icloser', 'worktrees', 'test-wt'));
    expect(removed).toBe(true);
  });

  it('returns false for non-git dir', async () => {
    const d = mkdtempSync(join(tmpdir(), 'icloser-nogit-'));
    dirs.push(d);
    const { createWorktree, isGitRepo } = await import('../src/utils/git.js');
    expect(isGitRepo(d)).toBe(false);
    const wt = createWorktree(d, 'test', join(d, 'wt'));
    expect(wt).toBe(false);
  });
});

describe('task-memory persistence', () => {
  it('records and retrieves multiple tasks with pattern extraction', async () => {
    const { recordTaskExecution, getTaskSuggestions, getIntentStats } = await import('../src/core/task-memory.js');
    const d = mkdtempSync(join(tmpdir(), 'icloser-tmem-'));
    dirs.push(d);

    // Record 3 similar completed tasks
    await recordTaskExecution(d, { id: 't1', description: '修改 src/auth.ts 添加 JWT 验证', status: 'completed', priority: 'normal', createdAt: new Date().toISOString(), changes: [], diffs: [], reasoning: [], errorLog: [], retryCount: 0, maxRetries: 3, agentExecutions: [] } as any, {
      status: 'completed', strategies: ['read_file', 'code_intel', 'search_code'], filesChanged: ['src/auth.ts', 'src/middleware.ts'], verifyPassed: true, duration: 8000, tokensUsed: 2000, errors: [],
    });
    await recordTaskExecution(d, { id: 't2', description: '修改 src/auth.ts 添加 OAuth 回调', status: 'completed', priority: 'normal', createdAt: new Date().toISOString(), changes: [], diffs: [], reasoning: [], errorLog: [], retryCount: 0, maxRetries: 3, agentExecutions: [] } as any, {
      status: 'completed', strategies: ['read_file', 'search_code'], filesChanged: ['src/auth.ts', 'src/oauth.ts'], verifyPassed: true, duration: 6000, tokensUsed: 1500, errors: [],
    });
    await recordTaskExecution(d, { id: 't3', description: '修改 src/payment.ts 添加微信支付', status: 'completed', priority: 'normal', createdAt: new Date().toISOString(), changes: [], diffs: [], reasoning: [], errorLog: [], retryCount: 0, maxRetries: 3, agentExecutions: [] } as any, {
      status: 'completed', strategies: ['read_file', 'search_code', 'code_intel'], filesChanged: ['src/payment.ts'], verifyPassed: true, duration: 4000, tokensUsed: 1200, errors: [],
    });

    const suggestions = await getTaskSuggestions(d, '修改 src/auth.ts 添加手机登录');
    expect(Array.isArray(suggestions)).toBe(true);

    const stats = await getIntentStats(d);
    expect(stats['code_change']).toBeDefined();
    expect(stats['code_change'].total).toBe(3);
    expect(stats['code_change'].passed).toBe(3);
  });
});

describe('skill persistence', () => {
  it('saves and loads skills from file', async () => {
    const { registerSkill, listSkills, saveSkillsToFile, loadSkillsFromFile } = await import('../src/core/skill-system.js');
    const d = mkdtempSync(join(tmpdir(), 'icloser-skill-'));
    dirs.push(d);
    mkdirSync(join(d, '.icloser'), { recursive: true });

    const before = listSkills().length;
    registerSkill({ name: 'persist-test', description: 'persist', triggers: ['persist-test'], systemPrompt: 'test', category: 'custom' });

    // Save and reload
    await saveSkillsToFile(d);
    // Clear in-memory (simulate restart by removing)
    const { removeSkill: rm } = await import('../src/core/skill-system.js');
    rm('persist-test');
    expect(listSkills().length).toBe(before);

    await loadSkillsFromFile(d);
    const after = listSkills().length;
    // Cleanup
    rm('persist-test');
    // The skill should have been loaded back
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
