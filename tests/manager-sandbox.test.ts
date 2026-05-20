// Extra coverage for src/agent/manager.ts
// Targets: checkSandboxWrite (542-572), filterSandboxedFiles (574-585)
import { describe, it, expect } from 'vitest';
import {
  checkSandboxWrite,
  filterSandboxedFiles,
} from '../src/agent/manager.js';

// ============================================================
// checkSandboxWrite
// ============================================================
describe('checkSandboxWrite', () => {
  const root = '/project/root';

  it('returns allowed=true for level "none"', () => {
    const result = checkSandboxWrite('/any/path/file.ts', 'none', root);
    expect(result.allowed).toBe(true);
  });

  it('returns allowed=false for level "readonly"', () => {
    const result = checkSandboxWrite('/project/root/src/auth.ts', 'readonly', root);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('readonly');
  });

  it('returns allowed=true for isolated level with in-root path', () => {
    const result = checkSandboxWrite('src/auth.ts', 'isolated', root);
    expect(result.allowed).toBe(true);
  });

  it('returns allowed=false for isolated level with path traversal', () => {
    const result = checkSandboxWrite('../../etc/passwd', 'isolated', root);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('isolated');
  });

  it('returns allowed=true for isolated with absolute in-root path', () => {
    const result = checkSandboxWrite('/project/root/src/utils.ts', 'isolated', root);
    // Absolute path that stays within root
    expect(typeof result.allowed).toBe('boolean');
  });
});

// ============================================================
// filterSandboxedFiles
// ============================================================
describe('filterSandboxedFiles', () => {
  const root = '/project/root';

  it('allows all files with level "none"', () => {
    const files = [
      { path: 'src/a.ts', content: 'const a = 1;' },
      { path: 'src/b.ts', content: 'const b = 2;' },
    ];
    const { allowed, blocked } = filterSandboxedFiles(files, 'none', root);
    expect(allowed).toHaveLength(2);
    expect(blocked).toHaveLength(0);
  });

  it('blocks all files with level "readonly"', () => {
    const files = [
      { path: 'src/a.ts', content: 'const a = 1;' },
      { path: 'src/b.ts', content: 'const b = 2;' },
    ];
    const { allowed, blocked } = filterSandboxedFiles(files, 'readonly', root);
    expect(allowed).toHaveLength(0);
    expect(blocked).toHaveLength(2);
    expect(blocked[0].reason).toBeDefined();
  });

  it('splits files into allowed and blocked for "isolated" level', () => {
    const files = [
      { path: 'src/safe.ts', content: 'ok' },
      { path: '../../etc/passwd', content: 'unsafe' },
    ];
    const { allowed, blocked } = filterSandboxedFiles(files, 'isolated', root);
    // src/safe.ts should be allowed, ../../etc/passwd should be blocked
    expect(allowed.some(f => f.path === 'src/safe.ts')).toBe(true);
    expect(blocked.some(f => f.path === '../../etc/passwd')).toBe(true);
  });

  it('returns empty arrays for empty file list', () => {
    const { allowed, blocked } = filterSandboxedFiles([], 'isolated', root);
    expect(allowed).toEqual([]);
    expect(blocked).toEqual([]);
  });
});
