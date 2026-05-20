import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getCommitSensitivePatterns,
  matchSensitivePattern,
  validateCommitSafety,
} from '../src/core/commit-security.js';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ic-commit-security-'));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('commit-security', () => {
  it('matches exact, wildcard, recursive and brace sensitive patterns', () => {
    expect(matchSensitivePattern('.env', '.env')).toBe(true);
    expect(matchSensitivePattern('server.pem', '*.pem')).toBe(true);
    expect(matchSensitivePattern('secrets/prod/token.txt', 'secrets/**')).toBe(true);
    expect(matchSensitivePattern('config.prod', 'config.{dev,prod}')).toBe(true);
  });

  it('combines default and configured sensitive patterns', () => {
    const patterns = getCommitSensitivePatterns({ security: { sensitiveFiles: ['private/**'] } });
    expect(patterns).toContain('.env');
    expect(patterns).toContain('private/**');
  });

  it('rejects empty message and empty file list before git execution', () => {
    const root = makeTempRoot();
    expect(validateCommitSafety(root, '   ', ['src/a.ts']).ok).toBe(false);
    expect(validateCommitSafety(root, 'feat: x', []).ok).toBe(false);
  });

  it('rejects path traversal outside repository root', () => {
    const root = makeTempRoot();
    const result = validateCommitSafety(root, 'feat: x', ['../outside.ts']);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('escapes');
  });

  it('rejects default sensitive files even without caller config', () => {
    const root = makeTempRoot();
    const result = validateCommitSafety(root, 'feat: x', ['.env']);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sensitive file blocked');
  });

  it('rejects symlink realpath escapes when target exists', () => {
    const root = makeTempRoot();
    const outside = makeTempRoot();
    mkdirSync(join(root, 'links'), { recursive: true });
    writeFileSync(join(outside, 'payload.txt'), 'secret');
    symlinkSync(outside, join(root, 'links', 'outside'), 'junction');

    const result = validateCommitSafety(root, 'feat: x', ['links/outside/payload.txt']);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('realpath escapes repository root');
  });

  it('allows normal project files', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;');

    const result = validateCommitSafety(root, 'feat: x', ['src/index.ts']);
    expect(result.ok).toBe(true);
  });
});
