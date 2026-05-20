import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import {
  buildCommitDraft,
  buildIssuePlan,
  buildPullRequestDraft,
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
});
