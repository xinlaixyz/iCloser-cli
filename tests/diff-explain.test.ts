import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildDiffExplanation } from '../src/commands/diff.js';

function makeGitProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'icloser-diff-'));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'memory.ts'), 'export const enabled = false;\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'memory.ts'), 'export const enabled = true;\nexport const explain = true;\n');
  return dir;
}

describe('diff explanation', () => {
  it('summarizes changed files, likely intent, risk, and checks', () => {
    const dir = makeGitProject();
    try {
      const explanation = buildDiffExplanation(dir);
      expect(explanation.changedFileCount).toBeGreaterThan(0);
      expect(explanation.files[0].file).toBe('memory.ts');
      expect(explanation.files[0].likelyIntent).toContain('长期记忆');
      expect(explanation.nextChecks).toContain('npx tsc --noEmit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
