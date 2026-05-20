// Coverage for src/core/code-writer.ts
// Targets: generateWithTests (115-150), generateScaffoldWithAI (302-352),
//          refactorCrossFile (354-406), readCodePatterns (7-32)
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateWithTests,
  generateScaffoldWithAI,
  refactorCrossFile,
} from '../src/core/code-writer.js';
import type { ProjectIndex } from '../src/types.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'cw-ai-'));
  roots.push(d);
  return d;
}

afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function makeMinimalIndex(dir: string): ProjectIndex {
  return {
    identity: {
      language: 'typescript',
      framework: 'express',
      buildSystem: 'npm',
      testFramework: 'vitest',
      runtime: 'node',
      languageVersion: '20',
      packageManager: 'npm',
    },
    modules: [],
    apis: [],
    dbSchema: [],
    dependencies: {},
    callGraph: [],
    dataflowGraph: [],
    styleFingerprint: {
      namingConvention: 'camelCase',
      indentStyle: 'spaces',
      indentSize: 2,
      quoteStyle: 'single',
      semicolons: true,
      errorHandling: 'try-catch',
    },
    totalFiles: 0,
    totalLines: 0,
    testFiles: 0,
    architecturePatterns: [],
  };
}

function makeProvider(content: string) {
  return { chat: async (_p: any) => ({ content, tokensUsed: 50 }) };
}

// ============================================================
// generateWithTests
// ============================================================
describe('generateWithTests', () => {
  it('generates source and tests with valid AI response', async () => {
    const dir = await makeDir();
    const index = makeMinimalIndex(dir);
    const sourceJson = JSON.stringify({
      changes: [
        { file: 'src/auth.ts', content: 'export function login(user: string): boolean { return true; }' },
        { file: 'src/session.ts', content: 'export function createSession(id: string): string { return id; }' },
      ],
    });
    const testJson = JSON.stringify({
      changes: [
        { file: 'tests/auth.test.ts', content: 'import { login } from "../src/auth"; it("works", () => {});' },
      ],
    });
    // Mock: first call returns source, second returns tests
    let callCount = 0;
    const provider = {
      chat: async (_p: any) => {
        callCount++;
        return { content: callCount === 1 ? sourceJson : testJson, tokensUsed: 50 };
      },
    };
    const result = await generateWithTests('Add auth module', dir, index, provider);
    expect(result.source.length).toBeGreaterThanOrEqual(1);
    expect(result.source[0].file).toBe('src/auth.ts');
    expect(result.tests.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty source+tests on invalid source JSON', async () => {
    const dir = await makeDir();
    const index = makeMinimalIndex(dir);
    const provider = makeProvider('not json at all without braces');
    const result = await generateWithTests('some task', dir, index, provider);
    // Invalid source JSON → early return { source: [], tests: [] }
    expect(result.source).toEqual([]);
    expect(result.tests).toEqual([]);
  });

  it('returns source with empty tests when test JSON is invalid', async () => {
    const dir = await makeDir();
    const index = makeMinimalIndex(dir);
    const sourceJson = JSON.stringify({
      changes: [{ file: 'src/x.ts', content: 'export const x = 1;' }],
    });
    let callCount = 0;
    const provider = {
      chat: async (_p: any) => {
        callCount++;
        return { content: callCount === 1 ? sourceJson : 'bad json without braces', tokensUsed: 50 };
      },
    };
    const result = await generateWithTests('task', dir, index, provider);
    expect(result.source.length).toBeGreaterThan(0);
    expect(result.tests).toEqual([]);
  });

  it('works with index that has modules (exercises readCodePatterns)', async () => {
    const dir = await makeDir();
    // Create a src file that readCodePatterns will try to read
    await writeFile(join(dir, 'utils.ts'), 'export const version = "1.0.0";', 'utf-8');
    const index = makeMinimalIndex(dir);
    index.modules = [{
      name: 'utils',
      files: ['utils.ts'],
      exports: [{ name: 'version', kind: 'const', signature: 'const version: string', file: 'utils.ts', line: 1 }],
      imports: [],
    }];
    const sourceJson = JSON.stringify({ changes: [] });
    const testJson = JSON.stringify({ changes: [] });
    let call = 0;
    const provider = {
      chat: async (_p: any) => ({ content: ++call === 1 ? sourceJson : testJson, tokensUsed: 50 }),
    };
    // Should not throw even though we try to read the file
    const result = await generateWithTests('task with patterns', dir, index, provider);
    expect(result).toBeDefined();
  });

  it('handles source with empty changes array (no files to generate tests for)', async () => {
    const dir = await makeDir();
    const index = makeMinimalIndex(dir);
    const sourceJson = JSON.stringify({ changes: [] }); // empty changes
    const testJson = JSON.stringify({ changes: [] });
    let call = 0;
    const provider = {
      chat: async (_p: any) => ({ content: ++call === 1 ? sourceJson : testJson, tokensUsed: 50 }),
    };
    const result = await generateWithTests('task', dir, index, provider);
    expect(result.source).toEqual([]);
    expect(result.tests).toEqual([]);
  });
});

// ============================================================
// generateScaffoldWithAI
// ============================================================
describe('generateScaffoldWithAI', () => {
  it('returns scaffold immediately when provider is null (no AI)', async () => {
    const dir = await makeDir();
    const result = await generateScaffoldWithAI('crud', 'user', 'typescript', dir, null, null);
    expect(result.files.length).toBe(3); // crud = 3 files
    expect(result.files[0].path).toContain('user');
  });

  it('calls AI to complete TODOs when provider is given (crud type)', async () => {
    const dir = await makeDir();
    const completedContent = 'export async function getUsers() { return []; }';
    const provider = makeProvider(`{"content": "${completedContent}"}`);
    const result = await generateScaffoldWithAI('crud', 'product', 'typescript', dir, null, provider);
    expect(result.files.length).toBe(3);
    // At least one file should have been completed
    expect(result.files.some(f => f.content.length > 0)).toBe(true);
  });

  it('returns original scaffold when AI output is unparseable', async () => {
    const dir = await makeDir();
    const provider = makeProvider('not valid json without braces');
    const result = await generateScaffoldWithAI('middleware', 'logging', 'typescript', dir, null, provider);
    // Should fall back to original TODO stub
    expect(result.files.length).toBe(1);
    expect(result.files[0].path).toContain('logging');
  });

  it('handles route scaffold with null provider', async () => {
    const dir = await makeDir();
    const result = await generateScaffoldWithAI('route', 'api', 'typescript', dir, null, null);
    expect(result.files.length).toBe(1);
    expect(result.files[0].content).toContain('Router');
  });

  it('handles component scaffold with style fingerprint', async () => {
    const dir = await makeDir();
    const style = {
      namingConvention: 'camelCase' as const,
      indentStyle: 'spaces' as const,
      indentSize: 2,
      quoteStyle: 'single' as const,
      semicolons: false,
      errorHandling: 'try-catch' as const,
    };
    const result = await generateScaffoldWithAI('component', 'Button', 'typescript', dir, null, null, style);
    expect(result.files.length).toBe(1);
    expect(result.files[0].path).toContain('Button');
  });

  // C26-fix: Python/Go/Java now have scaffold templates
  it('generates scaffold for Python (newly supported language)', async () => {
    const dir = await makeDir();
    const result = await generateScaffoldWithAI('crud', 'user', 'python', dir, null, null);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.some(f => f.path.includes('.py'))).toBe(true);
  });

  it('AI completing TODO returns same content when new content equals original', async () => {
    const dir = await makeDir();
    // Return the same content as the scaffold → should NOT update
    const provider = {
      chat: async (p: any) => {
        // Extract the scaffold content from the task and return it unchanged
        return { content: '{"content": "same content that wont change"}', tokensUsed: 50 };
      },
    };
    const result = await generateScaffoldWithAI('middleware', 'cache', 'typescript', dir, null, provider);
    expect(result.files.length).toBe(1);
  });
});

// ============================================================
// refactorCrossFile
// ============================================================
describe('refactorCrossFile', () => {
  it('returns empty files when no filePaths given and mock returns valid JSON', async () => {
    const dir = await makeDir();
    const response = JSON.stringify({
      files: [],
      explanation: 'No files to refactor',
    });
    const provider = makeProvider(response);
    const result = await refactorCrossFile([], 'Extract shared logic', dir, null, provider);
    expect(result.files).toEqual([]);
    expect(result.explanation).toBe('No files to refactor');
  });

  it('refactors files when provider returns valid changed files', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'old.ts');
    await writeFile(filePath, 'const OLD_CONSTANT = 1;', 'utf-8');

    const response = JSON.stringify({
      files: [{ path: filePath, content: 'const NEW_CONSTANT = 1; // refactored' }],
      explanation: 'Renamed constant for clarity',
    });
    const provider = makeProvider(response);
    const result = await refactorCrossFile([filePath], 'Rename constants', dir, null, provider);
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(result.explanation).toBe('Renamed constant for clarity');
    expect(result.files[0].original).toBe('const OLD_CONSTANT = 1;');
    expect(result.files[0].refactored).toBe('const NEW_CONSTANT = 1; // refactored');
  });

  it('returns empty files when AI response is invalid JSON (malformed braces)', async () => {
    const dir = await makeDir();
    // Must have { } but be invalid JSON to hit the catch branch
    const provider = makeProvider('{files: [broken json}');
    const result = await refactorCrossFile(['src/a.ts'], 'refactor', dir, null, provider);
    expect(result.files).toEqual([]);
    expect(result.explanation).toBe('AI 输出解析失败');
  });

  it('uses styleFingerprint from index when building prompt', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'module.ts');
    await writeFile(filePath, 'export const val = 1;', 'utf-8');

    let capturedSystemPrompt = '';
    const provider = {
      chat: async (p: any) => {
        capturedSystemPrompt = p.systemPrompt;
        return { content: JSON.stringify({ files: [], explanation: 'ok' }), tokensUsed: 50 };
      },
    };

    const mockIndex = {
      styleFingerprint: {
        namingConvention: 'camelCase' as const,
        indentStyle: 'spaces' as const,
        indentSize: 2,
        quoteStyle: 'single' as const,
        semicolons: true,
        errorHandling: 'try-catch' as const,
      },
    } as any;

    await refactorCrossFile([filePath], 'add comments', dir, mockIndex, provider);
    // System prompt should contain style constraints
    expect(typeof capturedSystemPrompt).toBe('string');
    expect(capturedSystemPrompt.length).toBeGreaterThan(0);
  });

  it('skips files that changed content equals original (no diff)', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'same.ts');
    const originalContent = 'export const same = 1;';
    await writeFile(filePath, originalContent, 'utf-8');

    const response = JSON.stringify({
      files: [{ path: filePath, content: originalContent }], // same as original
      explanation: 'No change needed',
    });
    const provider = makeProvider(response);
    const result = await refactorCrossFile([filePath], 'refactor', dir, null, provider);
    // Since content === original, no file should be pushed
    expect(result.files.filter(f => f.path === filePath)).toHaveLength(0);
    expect(result.explanation).toBe('No change needed');
  });

  it('handles file that cannot be read (does not throw)', async () => {
    const dir = await makeDir();
    const nonExistentPath = join(dir, 'does-not-exist.ts');
    const response = JSON.stringify({ files: [], explanation: 'done' });
    const provider = makeProvider(response);
    // Should not throw for unreadable file
    const result = await refactorCrossFile([nonExistentPath], 'refactor', dir, null, provider);
    expect(result).toBeDefined();
  });

  it('handles provider response with nested JSON in text', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'nested.ts');
    await writeFile(filePath, 'const x = 1;', 'utf-8');

    const response = `Here is the refactored output:\n${JSON.stringify({
      files: [{ path: filePath, content: 'const y = 2; // refactored' }],
      explanation: 'Renamed variable',
    })}`;
    const provider = makeProvider(response);
    const result = await refactorCrossFile([filePath], 'rename', dir, null, provider);
    expect(result.explanation).toBe('Renamed variable');
  });
});
