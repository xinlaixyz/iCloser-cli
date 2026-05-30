import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import {
  buildCommitDraft,
  buildGitHubPrCreateCommand,
  buildIssuePlan,
  buildPullRequestDraft,
  createGitHubPr,
} from '../src/commands/collaboration.js';

function makeGitProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'icloser-collab-'));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# Demo\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# Demo\n\nUpdated\n');
  return dir;
}

describe('collaboration command helpers', () => {
  it('buildIssuePlan creates actionable steps and acceptance criteria', () => {
    const plan = buildIssuePlan('Add login audit trail');
    expect(plan.title).toBe('Add login audit trail');
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    expect(plan.acceptance.length).toBeGreaterThanOrEqual(3);
  });

  it('buildPullRequestDraft summarizes branch and changed files', () => {
    const dir = makeGitProject();
    try {
      const draft = buildPullRequestDraft(dir, { title: 'Update docs', base: 'main' });
      expect(draft.title).toBe('Update docs');
      expect(draft.changedFiles).toContain('README.md');
      expect(draft.body).toContain('## Verification');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buildPullRequestDraft attaches latest task evidence when available', () => {
    const dir = makeGitProject();
    try {
      const taskDir = join(dir, '.icloser', 'tasks', 'task-demo');
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(join(taskDir, 'report.md'), '# Task Report\n\nCompleted safely.\n');
      writeFileSync(join(taskDir, 'verify.log'), 'npm test passed\n');
      const draft = buildPullRequestDraft(dir, { title: 'Update docs', base: 'main' });
      expect(draft.taskId).toBe('task-demo');
      expect(draft.body).toContain('## Task Evidence');
      expect(draft.body).toContain('Completed safely');
      expect(draft.body).toContain('npm test passed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buildCommitDraft never commits and produces verification suggestions', () => {
    const dir = makeGitProject();
    try {
      const draft = buildCommitDraft(dir);
      expect(draft.message).toContain('docs:');
      expect(draft.changedFiles).toContain('README.md');
      expect(draft.body).toContain('npm test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buildGitHubPrCreateCommand prepares gh arguments without pushing by default', () => {
    const dir = makeGitProject();
    try {
      const draft = buildPullRequestDraft(dir, { title: 'Test PR', base: 'main' });
      const args = buildGitHubPrCreateCommand(draft);
      expect(args.slice(0, 2)).toEqual(['pr', 'create']);
      expect(args).toContain('--title');
      expect(args).toContain('Test PR');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('createGitHubPr dry-run returns command and draft without requiring gh', () => {
    const dir = makeGitProject();
    try {
      const result = createGitHubPr(dir, { title: 'Dry PR', dryRun: true });
      expect(result.ok).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.command).toContain('gh pr create');
      expect(result.draft.title).toBe('Dry PR');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
