// Unit tests for src/core/memory/bootstrap.ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { bootstrapMemoryKernel } from '../src/core/memory/bootstrap.js';

const roots: string[] = [];

async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'bootstrap-test-'));
  roots.push(d);
  return d;
}

afterAll(async () => {
  for (const r of roots) try { await rm(r, { recursive: true, force: true }); } catch {}
});

function makeMockRuntime() {
  const episodes: any[] = [];
  const rules: any[] = [];
  return {
    episodic: {
      record: async (ep: any) => { episodes.push(ep); return ep; },
    },
    semantic: {
      query: (_opts: any) => [],
      add: (rule: any) => { rules.push(rule); },
      save: async () => {},
    },
    runConsolidation: async () => 0,
    _episodes: episodes,
    _rules: rules,
  };
}

describe('bootstrapMemoryKernel', () => {
  it('returns a BootstrapResult with expected shape', async () => {
    const dir = await makeDir();
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(typeof result.gitCommits).toBe('number');
    expect(typeof result.episodesCreated).toBe('number');
    expect(typeof result.rulesCreated).toBe('number');
    expect(Array.isArray(result.patternsFound)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('gitCommits is 0 for a non-git directory', async () => {
    const dir = await makeDir();
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.gitCommits).toBe(0);
  });

  it('detects TypeScript strict mode from tsconfig.json', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.patternsFound.some(p => p.includes('strict'))).toBe(true);
    expect(result.rulesCreated).toBeGreaterThan(0);
  });

  it('skips TypeScript strict rule when strict is false', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: false } }));
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.patternsFound.some(p => p.includes('strict'))).toBe(false);
  });

  it('detects .eslintrc.json config', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, '.eslintrc.json'), '{}');
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.patternsFound.some(p => p.toLowerCase().includes('eslint'))).toBe(true);
    expect(result.rulesCreated).toBeGreaterThan(0);
  });

  it('detects vitest.config.ts', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'vitest.config.ts'), 'export default {};');
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.patternsFound.some(p => p.includes('Vitest'))).toBe(true);
    expect(result.rulesCreated).toBeGreaterThan(0);
  });

  it('detects jest.config.js', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'jest.config.js'), 'module.exports = {};');
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.patternsFound.some(p => p.includes('Jest'))).toBe(true);
  });

  it('detects build and test scripts from package.json', async () => {
    const dir = await makeDir();
    const pkg = { name: 'test-app', scripts: { build: 'tsc --outDir dist', test: 'vitest run' } };
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg));
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.patternsFound.some(p => p.includes('npm run'))).toBe(true);
  });

  it('detects Dockerfile', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'Dockerfile'), 'FROM node:20\nWORKDIR /app');
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.patternsFound.some(p => p.toLowerCase().includes('docker'))).toBe(true);
    expect(result.rulesCreated).toBeGreaterThan(0);
  });

  it('detects middleware pattern from source files', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'middleware.ts'), 'export function authMiddleware() {}');
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.rulesCreated).toBeGreaterThan(0);
  });

  it('adds pattern if test file exists', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'utils.test.ts'), 'describe("x", () => {});');
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.patternsFound.some(p => p.includes('测试'))).toBe(true);
  });

  it('seeds git history when run in a git repository', async () => {
    const runtime = makeMockRuntime();
    const result = await bootstrapMemoryKernel(process.cwd(), runtime as any);
    // A real git repo — commits may or may not exist but no exception
    expect(typeof result.gitCommits).toBe('number');
    expect(typeof result.episodesCreated).toBe('number');
  });

  it('gracefully handles runConsolidation failure', async () => {
    const dir = await makeDir();
    const runtime = {
      episodic: { record: async () => {} },
      semantic: { query: () => [], add: () => {}, save: async () => {} },
      runConsolidation: async () => { throw new Error('consolidation down'); },
    };
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.errors.some(e => e.includes('固化失败'))).toBe(true);
  });

  it('gracefully handles semantic.save failure', async () => {
    const dir = await makeDir();
    const runtime = {
      episodic: { record: async () => {} },
      semantic: { query: () => [], add: () => {}, save: async () => { throw new Error('disk full'); } },
      runConsolidation: async () => 0,
    };
    const result = await bootstrapMemoryKernel(dir, runtime as any);
    expect(result.errors.some(e => e.includes('保存失败'))).toBe(true);
  });

  it('does not add duplicate rules (addRuleIfNew skips when rule exists)', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    const addedRules: any[] = [];
    const runtime = {
      episodic: { record: async () => {} },
      semantic: {
        // Pretend rule already exists → query returns non-empty
        query: () => [{ id: 'existing' }],
        add: (r: any) => addedRules.push(r),
        save: async () => {},
      },
      runConsolidation: async () => 0,
    };
    await bootstrapMemoryKernel(dir, runtime as any);
    // Since existing rule found, add should NOT be called for the TypeScript strict rule
    expect(addedRules.length).toBe(0);
  });
});
