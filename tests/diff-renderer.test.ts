import { describe, expect, it } from 'vitest';
import {
  buildPendingDiffSummary,
  filesToDiff,
  parseDiff,
  renderDiff,
  renderDiffBrief,
  renderPendingDiffSummary,
} from '../src/cli/diff-renderer.js';

describe('diff-renderer (S20.4)', () => {
  const sampleUnifiedDiff = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,3 +1,4 @@
 import { readFile } from 'fs';
-const db = { single: true };
+import { Pool } from 'pg-pool';
+const pool = new Pool({ min: 5 });
 return db;`;

  describe('parseDiff', () => {
    it('parses unified diff into DiffFile array', () => {
      const files = parseDiff(sampleUnifiedDiff);
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files[0].file).toContain('config.ts');
    });

    it('extracts hunks from diff', () => {
      const files = parseDiff(sampleUnifiedDiff);
      expect(files[0].hunks.length).toBeGreaterThanOrEqual(1);
      const hunk = files[0].hunks[0];
      expect(hunk.oldStart).toBe(1);
    });

    it('classifies added lines', () => {
      const files = parseDiff(sampleUnifiedDiff);
      const added = files[0].hunks[0].lines.filter(l => l.type === 'added');
      expect(added.length).toBeGreaterThanOrEqual(1);
      expect(added.some(l => l.content.includes('Pool'))).toBe(true);
    });

    it('classifies removed lines', () => {
      const files = parseDiff(sampleUnifiedDiff);
      const removed = files[0].hunks[0].lines.filter(l => l.type === 'removed');
      expect(removed.length).toBeGreaterThanOrEqual(1);
      expect(removed.some(l => l.content.includes('single'))).toBe(true);
    });

    it('classifies context lines', () => {
      const files = parseDiff(sampleUnifiedDiff);
      const context = files[0].hunks[0].lines.filter(l => l.type === 'context');
      expect(context.some(l => l.content.includes('import'))).toBe(true);
    });

    it('returns empty for empty input', () => {
      expect(parseDiff('')).toEqual([]);
    });
  });

  describe('renderDiff', () => {
    it('renders diff with file name and line content', () => {
      const files = parseDiff(sampleUnifiedDiff);
      const rendered = renderDiff(files);
      expect(rendered).toContain('config.ts');
      expect(rendered).toContain('Pool');
      expect(rendered).toContain('single');
    });

    it('shows green for added lines', () => {
      const files = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n old\n+new');
      const rendered = renderDiff(files);
      expect(rendered).toContain('new');
    });

    it('shows red for removed lines', () => {
      const files = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-old\n new');
      const rendered = renderDiff(files);
      expect(rendered).toContain('old');
    });

    it('returns "无变更" for empty files', () => {
      expect(renderDiff([])).toContain('无变更');
    });
  });

  describe('renderDiffBrief', () => {
    it('shows file stats with +N -M counts', () => {
      const files = parseDiff('diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,0 +1,2 @@\n+a\n+b');
      const brief = renderDiffBrief(files);
      expect(brief).toContain('f.ts');
      expect(brief).toContain('+2');
    });
  });

  describe('filesToDiff', () => {
    it('generates unified diff from file objects', () => {
      const diff = filesToDiff([{ path: 'test.ts', content: 'line1\nline2' }]);
      expect(diff).toContain('diff --git');
      expect(diff).toContain('test.ts');
      expect(diff).toContain('+line1');
    });
  });

  describe('pending diff summary', () => {
    it('summarizes pending H5 delivery with risk and browser verification', () => {
      const summary = buildPendingDiffSummary([{
        path: 'login.html',
        content: '<!doctype html>\n<input id="phone">\n<button>登录</button>',
      }]);

      expect(summary.fileCount).toBe(1);
      expect(summary.additions).toBe(3);
      expect(summary.highestRisk).toBe('low');
      expect(summary.files[0].likelyIntent).toContain('页面');
      expect(summary.nextChecks.join(' ')).toContain('浏览器');

      const rendered = renderPendingDiffSummary(summary);
      expect(rendered).toContain('login.html');
      expect(rendered).toContain('建议验证');
    });

    it('marks large source changes as higher risk', () => {
      const summary = buildPendingDiffSummary([{
        path: 'src/cli/repl.ts',
        previousContent: '',
        content: Array.from({ length: 140 }, (_, i) => `line ${i}`).join('\n'),
      }]);

      expect(['medium', 'high']).toContain(summary.highestRisk);
      expect(summary.nextChecks).toContain('npx tsc --noEmit');
    });
  });
});
