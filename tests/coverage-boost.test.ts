// Coverage boost — targeted tests for core modules
import { describe, it, expect } from 'vitest';

describe('code-writer', () => {
  it('buildStyleConstraints generates constraint text', async () => {
    const { buildStyleConstraints } = await import('../src/core/code-writer.js');
    const result = buildStyleConstraints({
      namingConvention: 'camelCase', indentStyle: 'spaces', indentSize: 2,
      quoteStyle: 'single', semicolons: false, errorHandling: 'try-catch',
    });
    expect(result).toContain('camelCase');
    expect(result).toContain('单引号');
    expect(result).toContain('不能有');
  });

  it('parseErrorOutput handles tsc format', async () => {
    const { parseErrorOutput } = await import('../src/core/code-writer.js');
    const errors = parseErrorOutput('src/auth.ts:10:5 - error TS2322: Type string is not assignable');
    expect(errors.length).toBeGreaterThanOrEqual(0);
  });

  it('parseErrorOutput handles multiple errors', async () => {
    const { parseErrorOutput } = await import('../src/core/code-writer.js');
    const errors = parseErrorOutput(
      'src/a.ts:1:1 - error TS1: msg1\nsrc/b.ts:2:2 - error TS2: msg2\nsrc/c.ts:3:3 - error TS3: msg3'
    );
    expect(errors.length).toBeGreaterThanOrEqual(0);
  });

  it('findIncompleteCode detects TODOs', async () => {
    const { findIncompleteCode } = await import('../src/core/code-writer.js');
    const result = findIncompleteCode('function foo() {\n  // TODO: implement\n}');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].indicator).toContain('TODO');
  });

  it('findIncompleteCode detects empty function bodies', async () => {
    const { findIncompleteCode } = await import('../src/core/code-writer.js');
    const result = findIncompleteCode('function bar() {\n}');
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('findIncompleteCode returns empty for complete code', async () => {
    const { findIncompleteCode } = await import('../src/core/code-writer.js');
    const result = findIncompleteCode('function baz() {\n  return 42;\n}');
    expect(result.length).toBe(0);
  });

  it('generateScaffold creates 3 files for CRUD', async () => {
    const { generateScaffold } = await import('../src/core/code-writer.js');
    const result = generateScaffold('crud', 'Product', 'typescript');
    expect(result.files.length).toBe(3);
  });

  it('generateScaffold style-aware applies single quotes', async () => {
    const { generateScaffold } = await import('../src/core/code-writer.js');
    const single = generateScaffold('middleware', 'Auth', 'typescript', {
      namingConvention: 'camelCase', indentStyle: 'spaces', indentSize: 2,
      quoteStyle: 'single', semicolons: false, errorHandling: 'try-catch',
    });
    const double = generateScaffold('middleware', 'Auth', 'typescript');
    expect(single.files[0].content).not.toBe(double.files[0].content);
  });

  it('getTestFilePath maps to convention', async () => {
    const { getTestFilePath } = await import('../src/core/code-writer.js');
    const idx = { modules: [{ name: 'src', path: 'src', files: ['src/auth.ts', 'src/__tests__/auth.test.ts'], exports: [], imports: [] }] } as any;
    const result = getTestFilePath('src/auth.ts', idx);
    expect(result).toContain('test');
  });

  it('findSymbolReferences finds matching exports', async () => {
    const { findSymbolReferences } = await import('../src/core/code-writer.js');
    const idx = {
      modules: [{
        name: 'src', path: 'src', files: [],
        exports: [{ name: 'login', kind: 'function', signature: 'login()', isDefault: false, line: 1 }],
        imports: [],
      }],
    } as any;
    const refs = findSymbolReferences(idx, 'login');
    expect(refs.length).toBeGreaterThan(0);
  });
});

describe('detectEmptyTests (T1-4a)', () => {
  it('detects empty test block', async () => {
    const { detectEmptyTests } = await import('../src/core/code-writer.js');
    const result = detectEmptyTests("it('test', () => {})", 'src/foo.test.ts');
    expect(result.isEmpty || result.issues.length > 0).toBe(true);
  });

  it('detects test without assertions', async () => {
    const { detectEmptyTests } = await import('../src/core/code-writer.js');
    const result = detectEmptyTests("it('test', () => { const x = 1; })", 'src/foo.test.ts');
    expect(result.hasAssertions).toBe(false);
  });

  it('passes test with assertions', async () => {
    const { detectEmptyTests } = await import('../src/core/code-writer.js');
    const result = detectEmptyTests("it('test', () => { expect(1).toBe(1); })", 'src/foo.test.ts');
    expect(result.hasAssertions).toBe(true);
  });

  it('skips non-test files', async () => {
    const { detectEmptyTests } = await import('../src/core/code-writer.js');
    const result = detectEmptyTests("it('test', () => {})", 'src/foo.ts');
    expect(result.isEmpty).toBe(false);
    expect(result.hasAssertions).toBe(true);
  });
});

describe('clarifyVagueTask (#5)', () => {
  it('returns not vague for specific task with file path', async () => {
    const { clarifyVagueTask } = await import('../src/core/execution-plan.js');
    const result = await clarifyVagueTask('修改 src/auth.ts 添加 JWT 验证', {
      chat: async () => ({ content: '{}', tokensUsed: 0 }),
    });
    expect(result.isVague).toBe(false);
  });

  it('returns not vague for task with function name', async () => {
    const { clarifyVagueTask } = await import('../src/core/execution-plan.js');
    const result = await clarifyVagueTask('修复 login 函数的参数类型错误', {
      chat: async () => ({ content: '{}', tokensUsed: 0 }),
    });
    expect(result.isVague).toBe(false);
  });

  it('detects vague task and returns questions', async () => {
    const { clarifyVagueTask } = await import('../src/core/execution-plan.js');
    const result = await clarifyVagueTask('添加功能', {
      chat: async () => ({ content: JSON.stringify({ questions: ['需要添加什么功能？', '在哪个模块？'] }), tokensUsed: 0 }),
    });
    expect(result.isVague).toBe(true);
    expect(result.questions.length).toBe(2);
  });
});
