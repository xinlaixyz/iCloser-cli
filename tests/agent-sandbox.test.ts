import { describe, expect, it } from 'vitest';
import { checkSandboxWrite, filterSandboxedFiles } from '../src/agent/manager.js';

const ROOT = '/home/user/project';

describe('Agent sandbox', () => {
  describe('checkSandboxWrite', () => {
    it('allows all writes when level is none', () => {
      expect(checkSandboxWrite('src/file.ts', 'none', ROOT).allowed).toBe(true);
      expect(checkSandboxWrite('/etc/passwd', 'none', ROOT).allowed).toBe(true);
    });

    it('blocks all writes when level is readonly', () => {
      const r = checkSandboxWrite('src/file.ts', 'readonly', ROOT);
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('readonly');
    });

    it('allows writes within project root when isolated', () => {
      expect(checkSandboxWrite('src/file.ts', 'isolated', ROOT).allowed).toBe(true);
      expect(checkSandboxWrite('src/deep/nested/file.ts', 'isolated', ROOT).allowed).toBe(true);
      expect(checkSandboxWrite('README.md', 'isolated', ROOT).allowed).toBe(true);
    });

    it('blocks path traversal attempts when isolated', () => {
      const r1 = checkSandboxWrite('../etc/passwd', 'isolated', ROOT);
      expect(r1.allowed).toBe(false);
      expect(r1.reason).toContain('isolated');

      const r2 = checkSandboxWrite('../../root/secret', 'isolated', ROOT);
      expect(r2.allowed).toBe(false);
    });

    it('blocks absolute paths outside project root when isolated', () => {
      const r = checkSandboxWrite('/etc/shadow', 'isolated', ROOT);
      expect(r.allowed).toBe(false);
    });
  });

  describe('filterSandboxedFiles', () => {
    it('filters files based on sandbox level', () => {
      const files = [
        { path: 'src/ok.ts', content: 'ok' },
        { path: '../outside.ts', content: 'bad' },
        { path: 'docs/readme.md', content: 'ok' },
      ];

      const { allowed, blocked } = filterSandboxedFiles(files, 'isolated', ROOT);
      expect(allowed.length).toBe(2);
      expect(allowed[0].path).toBe('src/ok.ts');
      expect(allowed[1].path).toBe('docs/readme.md');
      expect(blocked.length).toBe(1);
      expect(blocked[0].path).toBe('../outside.ts');
    });

    it('blocks all files in readonly mode', () => {
      const files = [
        { path: 'a.ts', content: 'a' },
        { path: 'b.ts', content: 'b' },
      ];
      const { allowed, blocked } = filterSandboxedFiles(files, 'readonly', ROOT);
      expect(allowed.length).toBe(0);
      expect(blocked.length).toBe(2);
    });

    it('allows all files in none mode', () => {
      const files = [
        { path: 'a.ts', content: 'a' },
        { path: '/etc/hosts', content: 'bad' },
      ];
      const { allowed } = filterSandboxedFiles(files, 'none', ROOT);
      expect(allowed.length).toBe(2);
    });
  });
});
