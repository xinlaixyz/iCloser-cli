import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { buildDocDrafts, buildDocWritePlan, writeDocs } from '../src/core/autodoc.js';
import type { AutopilotReport } from '../src/core/autopilot.js';

function makeReport(overrides: Partial<AutopilotReport> = {}): AutopilotReport {
  return {
    rootPath: '/fake/project',
    identity: {
      language: 'typescript',
      framework: 'unknown',
      database: 'unknown',
      buildSystem: 'npm',
      testFramework: 'vitest',
      runtime: 'node',
      deploymentType: 'unknown',
      packageManager: 'npm',
      languageVersion: 'unknown',
    },
    summary: {
      sourceFiles: 12,
      testFiles: 3,
      docFiles: 1,
      modules: 5,
      packageScripts: ['build: tsc', 'test: vitest run'],
    },
    docs: {
      required: [],
      existing: [],
      missing: [],
    },
    tests: {
      detected: true,
      files: 3,
      scripts: ['test: vitest run'],
      missingSuggestion: '',
    },
    findings: [],
    actions: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('autodoc', () => {
  it('builds drafts for all missing required docs', () => {
    const report = makeReport({
      docs: {
        required: ['docs/README.md', 'docs/PRD.md', 'docs/ARCHITECTURE.md', 'docs/API.md', 'docs/TESTING.md'],
        existing: ['docs/README.md'],
        missing: ['docs/PRD.md', 'docs/ARCHITECTURE.md', 'docs/API.md', 'docs/TESTING.md'],
      },
    });

    const drafts = buildDocDrafts(report);

    expect(drafts).toHaveLength(5);
    expect(drafts.find(d => d.file === 'docs/README.md')!.exists).toBe(true);
    expect(drafts.find(d => d.file === 'docs/PRD.md')!.exists).toBe(false);
    expect(drafts.every(d => d.content.length > 50)).toBe(true);
    expect(drafts.every(d => d.title.length > 0)).toBe(true);
  });

  it('generates readable PRD from project identity', () => {
    const report = makeReport({
      docs: { required: ['docs/PRD.md'], existing: [], missing: ['docs/PRD.md'] },
    });

    const drafts = buildDocDrafts(report);
    const prd = drafts[0];

    expect(prd.content).toContain('产品需求文档');
    expect(prd.content).toContain('typescript');
    expect(prd.content).toContain('vitest');
    expect(prd.content).toContain('npm');
  });

  it('does not overwrite existing docs by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autodoc-'));
    try {
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, 'docs', 'README.md'), 'existing content', 'utf-8');

      const report = makeReport({
        rootPath: root,
        docs: {
          required: ['docs/README.md', 'docs/PRD.md'],
          existing: ['docs/README.md'],
          missing: ['docs/PRD.md'],
        },
      });

      const plan = await buildDocWritePlan(root, report);
      const written = await writeDocs(root, plan);

      expect(written).toHaveLength(1);
      expect(written[0].file).toBe('docs/PRD.md');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('returns verified disk receipts for written docs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autodoc-'));
    try {
      const report = makeReport({
        rootPath: root,
        docs: {
          required: ['docs/PRD.md'],
          existing: [],
          missing: ['docs/PRD.md'],
        },
      });

      const plan = await buildDocWritePlan(root, report);
      const written = await writeDocs(root, plan);

      expect(written).toHaveLength(1);
      expect(written[0].fullPath.endsWith(join('docs', 'PRD.md'))).toBe(true);
      expect(written[0].verified).toBe(true);
      expect(written[0].bytes).toBeGreaterThan(50);
      expect(written[0].lines).toBeGreaterThan(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes docs to the docs/ directory only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autodoc-'));
    try {
      const report = makeReport({
        rootPath: root,
        docs: {
          required: ['docs/README.md'],
          existing: [],
          missing: ['docs/README.md'],
        },
      });

      const plan = await buildDocWritePlan(root, report);

      // All draft files must start with docs/
      for (const d of plan.docs) {
        expect(d.file.startsWith('docs/')).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips non-standard doc paths', () => {
    const report = makeReport({
      docs: { required: ['docs/README.md', 'outside.md'], existing: [], missing: ['docs/README.md', 'outside.md'] },
    });

    const drafts = buildDocDrafts(report);

    // only docs/README.md should generate content; outside.md has no generator
    expect(drafts).toHaveLength(1);
    expect(drafts[0].file).toBe('docs/README.md');
  });
});

