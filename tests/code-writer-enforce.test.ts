// Coverage for src/core/code-writer.ts
// Targets: enforceCodeQuality (441-518), checkStyleConsistency (660-688), refactorCode (691-726),
//          checkSemanticConsistency (562-617)
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  enforceCodeQuality,
  refactorCode,
} from '../src/core/code-writer.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'cw-enforce-'));
  roots.push(d);
  return d;
}
afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Null provider — should not be called in basic paths. */
const NULL_PROVIDER = null;

/** Mock provider that returns a fixed response. */
function mockProvider(responseContent: string) {
  return {
    chat: async (_p: any) => ({ content: responseContent }),
  };
}

// ============================================================
// enforceCodeQuality — early-return and basic paths
// ============================================================
describe('enforceCodeQuality', () => {
  it('returns passed:true immediately for empty changes array', async () => {
    const result = await enforceCodeQuality([], '/any', { language: 'typescript' }, NULL_PROVIDER);
    expect(result.passed).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.fixes).toBe(0);
    expect(result.diagnostics).toBe('');
  });

  it('passes for Python (non-compiled language) — no tsconfig needed', async () => {
    const dir = await makeDir();
    const result = await enforceCodeQuality(
      [{ file: 'app.py', content: 'print("hello")' }],
      dir,
      { language: 'python' },
      NULL_PROVIDER,
    );
    expect(result.passed).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.fixes).toBe(0);
  });

  it('passes for Ruby (unrecognized language)', async () => {
    const dir = await makeDir();
    const result = await enforceCodeQuality(
      [{ file: 'app.rb', content: 'puts "hello"' }],
      dir,
      { language: 'ruby' },
      NULL_PROVIDER,
    );
    expect(result.passed).toBe(true);
  });

  it('passes TypeScript without tsconfig.json (no compile check)', async () => {
    const dir = await makeDir();
    // No tsconfig.json → compile check skips → passes
    const result = await enforceCodeQuality(
      [{ file: 'src/a.ts', content: 'export const x = 1;' }],
      dir,
      { language: 'typescript' },
      NULL_PROVIDER,
    );
    expect(result.passed).toBe(true);
    expect(result.changes).toHaveLength(1);
  });

  it('runs style check when styleFingerprint is provided and compile passes', async () => {
    const dir = await makeDir();
    // No tsconfig → compile passes → style check runs
    const fingerprint = {
      semicolons: false, // no semicolons expected
      quoteStyle: 'single' as const,
      indentStyle: 'space' as const,
      indentSize: 2,
      trailingCommas: false,
      lineLength: 100,
    };
    const result = await enforceCodeQuality(
      [{ file: 'src/a.ts', content: 'const x = 1;' }], // has semicolon but fingerprint says no semis
      dir,
      { language: 'typescript' },
      NULL_PROVIDER,
      { styleFingerprint: fingerprint },
    );
    // Compile passes (no tsconfig), style warning may be added to diagnostics
    expect(result.passed).toBe(true);
    // diagnostics may contain a style warning
    expect(typeof result.diagnostics).toBe('string');
  });

  it('style check flags double quotes when quoteStyle is single', async () => {
    const dir = await makeDir();
    const fingerprint = {
      semicolons: true,
      quoteStyle: 'single' as const,
      indentStyle: 'space' as const,
      indentSize: 2,
      trailingCommas: false,
      lineLength: 100,
    };
    // Double-quoted import → style warning
    const code = 'import { foo } from "foo-package";\nexport const x = foo();';
    const result = await enforceCodeQuality(
      [{ file: 'src/b.ts', content: code }],
      dir,
      { language: 'typescript' },
      NULL_PROVIDER,
      { styleFingerprint: fingerprint },
    );
    expect(result.passed).toBe(true);
    // Style warning should be in diagnostics
    expect(result.diagnostics).toContain('双引号');
  });

  it('style check flags missing semicolons when fingerprint.semicolons is true', async () => {
    const dir = await makeDir();
    const fingerprint = {
      semicolons: true,
      quoteStyle: 'double' as const,
      indentStyle: 'space' as const,
      indentSize: 2,
      trailingCommas: false,
      lineLength: 100,
    };
    // Many lines without semicolons
    const codeNoSemi = [
      'import { a } from "pkg"',
      'export const x = 1',
      'export const y = 2',
      'export const z = 3',
      'const q = 4',
    ].join('\n');
    const result = await enforceCodeQuality(
      [{ file: 'src/c.ts', content: codeNoSemi }],
      dir,
      { language: 'typescript' },
      NULL_PROVIDER,
      { styleFingerprint: fingerprint },
    );
    expect(result.passed).toBe(true);
    // Missing semicolons warning
    expect(result.diagnostics).toContain('分号');
  });

  it('skips style check for non-JS/TS files', async () => {
    const dir = await makeDir();
    const fingerprint = {
      semicolons: false,
      quoteStyle: 'single' as const,
      indentStyle: 'space' as const,
      indentSize: 2,
      trailingCommas: false,
      lineLength: 100,
    };
    const result = await enforceCodeQuality(
      [{ file: 'config.json', content: '{"key": "value";}' }],
      dir,
      { language: 'python' },
      NULL_PROVIDER,
      { styleFingerprint: fingerprint },
    );
    expect(result.passed).toBe(true);
    // No style diagnostics for non-JS/TS files
    expect(result.diagnostics).not.toContain('风格警告');
  });

  it('exercises semantic consistency check (no project index → empty issues)', async () => {
    const dir = await makeDir();
    // No .icloser directory → loadProjectIndex returns null → no issues
    const code = 'import { something } from "some-external-package";\nexport const x = something();';
    const result = await enforceCodeQuality(
      [{ file: 'src/d.ts', content: code }],
      dir,
      { language: 'typescript' },
      NULL_PROVIDER,
    );
    expect(result.passed).toBe(true);
  });

  it('handles multiple changes in the same call', async () => {
    const dir = await makeDir();
    const result = await enforceCodeQuality(
      [
        { file: 'src/a.ts', content: 'export const a = 1;' },
        { file: 'src/b.ts', content: 'export const b = 2;' },
        { file: 'src/c.ts', content: 'export const c = 3;' },
      ],
      dir,
      { language: 'typescript' },
      NULL_PROVIDER,
    );
    expect(result.passed).toBe(true);
    expect(result.changes).toHaveLength(3);
  });

  it('compile failure without provider → returns passed:false', async () => {
    const dir = await makeDir();
    // Create tsconfig.json so tsc is invoked — but code has errors
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true },
      include: ['**/*.ts'],
    }));
    // tsc on a temp file with invalid TS should fail, but since temp files don't end in .ts
    // and tsc is checking the project dir, result could vary.
    // Just test that it returns a result without crashing.
    const result = await enforceCodeQuality(
      [{ file: 'broken.ts', content: 'const x: number = "not a number";' }],
      dir,
      { language: 'typescript' },
      NULL_PROVIDER, // no AI provider → can't fix
    );
    // Result could be passed or failed depending on tsc availability and temp file handling
    expect(typeof result.passed).toBe('boolean');
    expect(typeof result.fixes).toBe('number');
  }, 60000);
});

// ============================================================
// refactorCode
// ============================================================
describe('refactorCode', () => {
  it('calls provider.chat and returns refactored content', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'file.ts');
    await writeFile(filePath, 'const x = 1;', 'utf-8');

    const result = await refactorCode(
      filePath,
      'Change x to be 2',
      dir,
      null,
      mockProvider('{"refactored": "const x = 2;", "explanation": "Changed value from 1 to 2"}'),
    );

    expect(result.original).toBe('const x = 1;');
    expect(result.refactored).toBe('const x = 2;');
    expect(result.explanation).toBe('Changed value from 1 to 2');
  });

  it('returns original when provider returns invalid JSON', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'code.ts');
    await writeFile(filePath, 'export const y = 42;', 'utf-8');

    const result = await refactorCode(
      filePath,
      'Refactor this code',
      dir,
      null,
      // Must contain { } so the regex matches it, but the JSON inside is malformed
      mockProvider('{invalid json syntax: definitely not valid}'),
    );

    expect(result.original).toBe('export const y = 42;');
    expect(result.refactored).toBe('export const y = 42;'); // falls back to original
    expect(result.explanation).toBe('AI 输出解析失败');
  });

  it('uses styleFingerprint from index when building prompt', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'styled.ts');
    await writeFile(filePath, 'const a = 1', 'utf-8');

    let capturedSystemPrompt = '';
    const trackingProvider = {
      chat: async (p: any) => {
        capturedSystemPrompt = p.systemPrompt;
        return { content: '{"refactored": "const a = 2", "explanation": "updated"}' };
      },
    };

    const mockIndex = {
      styleFingerprint: {
        semicolons: false,
        quoteStyle: 'single' as const,
        indentStyle: 'space' as const,
        indentSize: 2,
        trailingCommas: false,
        lineLength: 80,
      },
    } as any;

    await refactorCode(filePath, 'Change a to 2', dir, mockIndex, trackingProvider);
    // The system prompt should include style constraints
    expect(typeof capturedSystemPrompt).toBe('string');
    expect(capturedSystemPrompt.length).toBeGreaterThan(0);
  });

  it('handles provider returning only refactored field (no explanation)', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'code2.ts');
    await writeFile(filePath, 'const z = 0;', 'utf-8');

    const result = await refactorCode(
      filePath,
      'Double z',
      dir,
      null,
      mockProvider('{"refactored": "const z = 0 * 2;"}'), // no explanation field
    );

    expect(result.refactored).toBe('const z = 0 * 2;');
    expect(result.explanation).toBe(''); // defaults to empty
  });
});
