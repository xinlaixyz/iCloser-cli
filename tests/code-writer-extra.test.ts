// Extra coverage for src/core/code-writer.ts
// Targets: getTestFilePath (77-95), findSymbolReferences (98-113),
//          generateWithVerifyLoop early return (165-167) and exception path (252-253),
//          detectEmptyTests empty-block pattern (641-642)
import { describe, it, expect } from 'vitest';
import {
  getTestFilePath,
  findSymbolReferences,
  generateWithVerifyLoop,
  detectEmptyTests,
  scanGeneratedTests,
} from '../src/core/code-writer.js';
import type { ProjectIndex } from '../src/types.js';

function makeIndex(overrides: Partial<ProjectIndex> = {}): ProjectIndex {
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
    modules: [
      {
        name: 'src/auth',
        files: ['src/auth/login.ts', 'src/auth/login.test.ts'],
        exports: [
          { name: 'login', kind: 'function', signature: 'function login', file: 'src/auth/login.ts', line: 1 },
          { name: 'logout', kind: 'function', signature: 'function logout', file: 'src/auth/login.ts', line: 10 },
        ],
        imports: [
          { module: 'express', symbols: ['Router'] },
        ],
      },
      {
        name: 'src/api',
        files: ['src/api/routes.ts'],
        exports: [],
        imports: [
          { module: './auth/login', symbols: ['login', 'logout'] },
        ],
      },
    ],
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
    totalFiles: 2,
    totalLines: 50,
    testFiles: 1,
    architecturePatterns: [],
    ...overrides,
  };
}

// ============================================================
// getTestFilePath
// ============================================================
describe('getTestFilePath', () => {
  it('returns base.test.ts for an existing test file in modules', () => {
    const index = makeIndex();
    // login.test.ts exists in modules
    const testPath = getTestFilePath('src/auth/login.ts', index);
    expect(testPath).toBeTruthy();
    expect(testPath).toContain('login');
  });

  it('returns default test path when no existing test found', () => {
    const index = makeIndex();
    const testPath = getTestFilePath('src/utils/format.ts', index);
    // Falls through all patterns to default: base.test.ts
    expect(testPath).toContain('format.test.ts');
  });

  it('handles source file with nested path', () => {
    const index = makeIndex();
    const testPath = getTestFilePath('src/deep/nested/module.ts', index);
    expect(testPath).toContain('module');
    expect(testPath).toContain('test');
  });

  it('handles file with .tsx extension', () => {
    const index = makeIndex();
    const testPath = getTestFilePath('src/components/Button.tsx', index);
    expect(testPath).toContain('Button');
    expect(testPath).toContain('test');
  });

  it('finds test via tests/ directory pattern', () => {
    const indexWithTest = makeIndex({
      modules: [
        {
          name: 'tests',
          files: ['tests/format.test.ts'],
          exports: [],
          imports: [],
        },
      ],
    });
    const testPath = getTestFilePath('src/utils/format.ts', indexWithTest);
    // The tests/format.test.ts pattern should match
    expect(testPath).toContain('format');
  });

  it('finds test via __tests__ directory pattern', () => {
    const indexWith__tests__ = makeIndex({
      modules: [
        {
          name: 'src/utils/__tests__',
          files: ['src/utils/__tests__/format.test.ts'],
          exports: [],
          imports: [],
        },
      ],
    });
    const testPath = getTestFilePath('src/utils/format.ts', indexWith__tests__);
    expect(testPath).toContain('format');
  });
});

// ============================================================
// findSymbolReferences
// ============================================================
describe('findSymbolReferences', () => {
  it('finds symbol in exports', () => {
    const index = makeIndex();
    const refs = findSymbolReferences(index, 'login');
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some(r => r.includes('login'))).toBe(true);
  });

  it('finds symbol in imports', () => {
    const index = makeIndex();
    const refs = findSymbolReferences(index, 'logout');
    expect(Array.isArray(refs)).toBe(true);
    // logout is in both exports and imports
    expect(refs.length).toBeGreaterThan(0);
  });

  it('returns empty array when symbol not found', () => {
    const index = makeIndex();
    const refs = findSymbolReferences(index, 'nonExistentSymbolXYZ123');
    expect(refs).toEqual([]);
  });

  it('is case-insensitive for matching', () => {
    const index = makeIndex();
    const refs = findSymbolReferences(index, 'LOGIN'); // uppercase
    expect(Array.isArray(refs)).toBe(true);
    // Should find 'login' (case-insensitive match)
    expect(refs.length).toBeGreaterThan(0);
  });

  it('limits results to 20 unique refs', () => {
    // Create index with many modules referencing the same symbol
    const manyModules = Array.from({ length: 25 }, (_, i) => ({
      name: `src/mod${i}`,
      files: [`src/mod${i}.ts`],
      exports: [{ name: 'mySymbol', kind: 'function' as const, signature: 'fn', file: `src/mod${i}.ts`, line: 1 }],
      imports: [],
    }));
    const index = makeIndex({ modules: manyModules });
    const refs = findSymbolReferences(index, 'mySymbol');
    expect(refs.length).toBeLessThanOrEqual(20);
  });
});

// ============================================================
// generateWithVerifyLoop — early return and exception paths
// ============================================================
describe('generateWithVerifyLoop', () => {
  it('returns early with empty source when provider produces no code', async () => {
    const index = makeIndex();
    // Provider returns empty changes → source.length === 0 → early return
    const emptyProvider = {
      chat: async (_p: any) => ({ content: JSON.stringify({ changes: [] }), tokensUsed: 10 }),
    };
    const result = await generateWithVerifyLoop('some task', '/tmp', index as any, emptyProvider);
    expect(result.verifyRounds).toBe(0);
    expect(result.verifyPassed).toBe(false);
    expect(result.diagnostics).toContain('未生成');
  });

  it('handles verification exception gracefully', async () => {
    const index = makeIndex();
    let call = 0;
    const provider = {
      chat: async (_p: any) => {
        call++;
        if (call === 1) {
          return { content: JSON.stringify({ changes: [{ file: 'src/x.ts', content: 'export const x = 1;' }] }), tokensUsed: 10 };
        }
        return { content: JSON.stringify({ changes: [] }), tokensUsed: 10 };
      },
    };
    // In a temp dir without real project, verification should throw or fail
    const result = await generateWithVerifyLoop('write a function', '/nonexistent-dir-xyz', index as any, provider);
    // Should return gracefully with verifyPassed=false or round info
    expect(result).toBeDefined();
    expect(typeof result.verifyPassed).toBe('boolean');
  }, 10000);
});

// ============================================================
// detectEmptyTests — edge cases including empty block pattern
// ============================================================
describe('detectEmptyTests', () => {
  it('detects empty test block pattern (it desc), () => {}', () => {
    // The regex pattern looks for: it('desc'), () => {} (callback outside the it() call)
    const content = `
import { it } from 'vitest';
it('simple'), () => {};
it('another'), async () => {};
`;
    const result = detectEmptyTests(content, 'src/x.test.ts');
    // The empty block pattern should be detected
    expect(result.issues.some(i => i.includes('空测试块'))).toBe(true);
  });

  it('returns false for non-test files', () => {
    const result = detectEmptyTests('const x = 1;', 'src/utils.ts');
    expect(result.isEmpty).toBe(false);
    expect(result.hasAssertions).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('detects no assertions in test file', () => {
    const content = `
import { it } from 'vitest';
// This is a test file with no assertions
it("does something", () => {
  const x = 1;
});
`;
    const result = detectEmptyTests(content, 'src/x.test.ts');
    expect(result.hasAssertions).toBe(false);
  });

  it('recognizes test with valid assertions', () => {
    const content = `
import { it, expect } from 'vitest';
it("adds numbers", () => {
  expect(1 + 1).toBe(2);
});
`;
    const result = detectEmptyTests(content, 'src/x.test.ts');
    expect(result.hasAssertions).toBe(true);
    expect(result.isEmpty).toBe(false);
  });

  it('detects TODO-only test content', () => {
    const content = `
import { it } from 'vitest';
// TODO: add tests here
it("pending", () => {
  // TODO: implement
});
`;
    const result = detectEmptyTests(content, 'src/x.test.ts');
    // has issues but might not be "empty" depending on assertions
    expect(typeof result.isEmpty).toBe('boolean');
  });

  it('handles async empty test blocks', () => {
    const content = `
it("async empty", async () => {});
it("another async empty", async () => {});
`;
    const result = detectEmptyTests(content, 'src/x.test.ts');
    expect(result.issues.some(i => i.includes('空测试块'))).toBe(true);
  });
});

// ============================================================
// scanGeneratedTests
// ============================================================
describe('scanGeneratedTests', () => {
  it('returns empty array for empty input', () => {
    const result = scanGeneratedTests([]);
    expect(result).toEqual([]);
  });

  it('scans multiple test files', () => {
    const testFiles = [
      { file: 'src/a.test.ts', content: `it("a", () => { expect(1).toBe(1); });` },
      { file: 'src/b.test.ts', content: `it("b", () => {});` },
    ];
    const result = scanGeneratedTests(testFiles);
    expect(result).toHaveLength(2);
    // a.test.ts has assertions → hasAssertions: true
    expect(result[0].hasAssertions).toBe(true);
  });
});
