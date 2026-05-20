// Unit tests for src/utils/git.ts — using the actual project git repo
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  isGitRepo,
  getCurrentBranch,
  getGitStatus,
  getDiff,
  getLog,
  getGitRoot,
} from '../src/utils/git.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

describe('isGitRepo', () => {
  it('returns true for a valid git repo', () => {
    expect(isGitRepo(ROOT)).toBe(true);
  });

  it('returns false for a non-git directory', () => {
    const { tmpdir } = require('os');
    const { mkdtempSync, rmSync } = require('fs');
    const { join: pjoin } = require('path');
    const dir = mkdtempSync(pjoin(tmpdir(), 'icloser-notgit-'));
    try {
      expect(isGitRepo(dir)).toBe(false);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
});

describe('getCurrentBranch', () => {
  it('returns a non-empty string', () => {
    const branch = getCurrentBranch(ROOT);
    expect(typeof branch).toBe('string');
    expect(branch.length).toBeGreaterThan(0);
  });

  it('returns "unknown" for non-git directory', () => {
    const branch = getCurrentBranch('/nonexistent/path');
    expect(branch).toBe('unknown');
  });
});

describe('getGitRoot', () => {
  it('returns the project root path', () => {
    const root = getGitRoot(ROOT);
    expect(typeof root).toBe('string');
    expect(root.length).toBeGreaterThan(0);
  });
});

describe('getGitStatus', () => {
  it('returns GitStatus with expected fields', () => {
    const status = getGitStatus(ROOT);
    expect(typeof status.branch).toBe('string');
    expect(typeof status.clean).toBe('boolean');
    expect(Array.isArray(status.changed)).toBe(true);
    expect(Array.isArray(status.untracked)).toBe(true);
    expect(Array.isArray(status.staged)).toBe(true);
  });

  it('branch matches getCurrentBranch', () => {
    const branch = getCurrentBranch(ROOT);
    const status = getGitStatus(ROOT);
    expect(status.branch).toBe(branch);
  });
});

describe('getDiff', () => {
  it('returns a string (may be empty for clean repo)', () => {
    const diff = getDiff(ROOT);
    expect(typeof diff).toBe('string');
  });

  it('staged diff returns a string', () => {
    const diff = getDiff(ROOT, true);
    expect(typeof diff).toBe('string');
  });

  it('returns empty string for non-git path', () => {
    const diff = getDiff('/nonexistent/path');
    expect(diff).toBe('');
  });
});

describe('getLog', () => {
  it('returns git log as string', () => {
    const log = getLog(ROOT);
    expect(typeof log).toBe('string');
  });

  it('respects count parameter', () => {
    const log5 = getLog(ROOT, 5);
    const log1 = getLog(ROOT, 1);
    expect(log5.length).toBeGreaterThanOrEqual(log1.length);
  });

  it('returns empty string for non-git path', () => {
    const log = getLog('/nonexistent/path');
    expect(log).toBe('');
  });
});
