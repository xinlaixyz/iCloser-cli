// Coverage: docs-generator, gate/checker, report/generator — previously zero coverage
import { describe, it, expect } from 'vitest';

describe('docs-generator', () => {
  it('DOC_TEMPLATES is defined', async () => {
    const { DOC_TEMPLATES } = await import('../src/core/docs-generator.js');
    expect(Array.isArray(DOC_TEMPLATES)).toBe(true);
    expect(DOC_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('detectDocGaps finds missing docs', async () => {
    const { detectDocGaps } = await import('../src/core/docs-generator.js');
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const d = mkdtempSync(join(tmpdir(), 'icloser-dg-'));
    try {
      const result = await detectDocGaps(d, { modules: [], identity: {} } as any);
      expect(result.missing.length).toBeGreaterThan(0);
    } finally { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  it('checkDocumentQuality evaluates content', async () => {
    const { checkDocumentQuality } = await import('../src/core/docs-generator.js');
    const result = checkDocumentQuality('# Title\nThis is a document.\n## Section\nContent');
    expect(result.score).toBeGreaterThan(0);
    expect(typeof result.pass).toBe('boolean');
  });

  it('checkDocumentQuality penalizes empty content', async () => {
    const { checkDocumentQuality } = await import('../src/core/docs-generator.js');
    const result = checkDocumentQuality('');
    expect(result.score).toBeLessThan(50);
  });

  it('checkDocumentQuality detects TODOs', async () => {
    const { checkDocumentQuality } = await import('../src/core/docs-generator.js');
    const result = checkDocumentQuality('# TODO: finish this');
    expect(result.issues.some(i => i.includes('TODO'))).toBe(true);
  });

  it('editDocumentSection returns diff', async () => {
    const { editDocumentSection } = await import('../src/core/docs-generator.js');
    const { mkdtempSync, writeFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const d = mkdtempSync(join(tmpdir(), 'icloser-dg-'));
    try {
      writeFileSync(join(d, 'test.md'), '# Old Title\nold content');
      const mockProvider = { chat: async () => ({ content: '# New Title\nnew content', tokensUsed: 10 }) };
      const result = await editDocumentSection(join(d, 'test.md'), 'update', mockProvider);
      expect(result.original).toContain('Old Title');
      expect(result.modified).toContain('New Title');
      expect(result.diff).toBeTruthy();
    } finally { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  it('searchDocs searches content', async () => {
    const { searchDocs } = await import('../src/core/docs-generator.js');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const d = mkdtempSync(join(tmpdir(), 'icloser-dg-'));
    try {
      mkdirSync(join(d, 'docs'), { recursive: true });
      writeFileSync(join(d, 'docs', 'README.md'), '# Project\nAPI documentation here');
      const results = await searchDocs(d, 'API');
      expect(Array.isArray(results)).toBe(true);
    } finally { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  });
});

describe('gate/checker', () => {
  it('runGateCheck exports function', async () => {
    const mod = await import('../src/gate/checker.js');
    expect(typeof mod.runGateCheck).toBe('function');
  });
});

describe('report/generator', () => {
  it('generateTaskReport is a function', async () => {
    const mod = await import('../src/report/generator.js');
    expect(typeof mod.generateTaskReport).toBe('function');
    expect(typeof mod.generateReasoningFile).toBe('function');
    expect(typeof mod.generateVerifyLog).toBe('function');
    expect(typeof mod.generateDiffFile).toBe('function');
  });
});
