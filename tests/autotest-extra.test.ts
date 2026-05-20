// Extra coverage for src/core/autotest.ts
// Targets: generatePythonTest (179-190), generateGoTest (192-204),
//          generateJavaTest (206-220), writeTests selected/overwrite branches (79-100),
//          renderTestWritePlan no-target branch (102-113),
//          suggestFallbackTestFile (230-232), generateJavaScriptTest with exports (154-165)
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildTestWritePlan,
  renderTestWritePlan,
  writeTests,
} from '../src/core/autotest.js';
import type { TestWritePlan, TestDraft } from '../src/core/autotest.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'autotest-ex-'));
  roots.push(d);
  return d;
}

afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// Helper: create a fake AutopilotTestPlan for various source types
function makePlan(sourceFile: string, testFile: string, framework = 'vitest') {
  return {
    testCommand: 'npm run test',
    detectedFramework: framework,
    targets: [
      {
        module: 'src/module',
        coverageStatus: 'uncovered' as const,
        sourceFiles: [sourceFile],
        suggestedTestFiles: [testFile],
        estimatedLines: 10,
        priority: 1,
      },
    ],
  };
}

// ============================================================
// generatePythonTest (via buildTestWritePlan with .py extension)
// ============================================================
describe('buildTestWritePlan — Python source', () => {
  it('generates Python test scaffold for .py files', async () => {
    const dir = await makeDir();
    const plan = makePlan('src/utils.py', 'src/utils_test.py');
    const writePlan = await buildTestWritePlan(dir, plan as any);
    expect(writePlan.tests.length).toBeGreaterThan(0);
    const content = writePlan.tests[0].content;
    // Python test uses importlib
    expect(content).toContain('importlib');
    expect(content).toContain('def test_');
  });
});

// ============================================================
// generateGoTest (via buildTestWritePlan with .go extension)
// ============================================================
describe('buildTestWritePlan — Go source', () => {
  it('generates Go test scaffold for .go files', async () => {
    const dir = await makeDir();
    const plan = makePlan('internal/handler/api.go', 'internal/handler/api_test.go');
    const writePlan = await buildTestWritePlan(dir, plan as any);
    expect(writePlan.tests.length).toBeGreaterThan(0);
    const content = writePlan.tests[0].content;
    expect(content).toContain('import "testing"');
    expect(content).toContain('func TestModuleCompiles');
  });
});

// ============================================================
// generateJavaTest (via buildTestWritePlan with .java extension)
// ============================================================
describe('buildTestWritePlan — Java source', () => {
  it('generates Java test scaffold for .java files', async () => {
    const dir = await makeDir();
    const plan = makePlan('src/main/UserService.java', 'src/test/UserServiceTest.java');
    const writePlan = await buildTestWritePlan(dir, plan as any);
    expect(writePlan.tests.length).toBeGreaterThan(0);
    const content = writePlan.tests[0].content;
    expect(content).toContain('import org.junit.jupiter.api.Test');
    expect(content).toContain('class UserServiceTest');
  });
});

// ============================================================
// generateJavaScriptTest with jest framework (covers api branch)
// ============================================================
describe('buildTestWritePlan — Jest framework', () => {
  it('uses jest api import for jest-based projects', async () => {
    const dir = await makeDir();
    const plan = makePlan('src/utils.ts', 'src/utils.test.ts', 'jest');
    const writePlan = await buildTestWritePlan(dir, plan as any);
    const content = writePlan.tests[0].content;
    expect(content).toContain('@jest/globals');
  });
});

// ============================================================
// renderTestWritePlan — no-target branch (all covered)
// ============================================================
describe('renderTestWritePlan — empty plan', () => {
  it('renders a message when no target found', () => {
    const emptyPlan: TestWritePlan = {
      rootPath: '/test',
      testCommand: 'npm test',
      target: null,
      tests: [],
      totalNew: 0,
      totalExisting: 0,
    };
    const text = renderTestWritePlan(emptyPlan);
    expect(text).toContain('安全测试写入计划');
    expect(text).toContain('暂无缺口');
    expect(text).toContain('暂未找到需要自动补测的模块');
  });

  it('renders plan with existing test marked', async () => {
    const dir = await makeDir();
    // Pre-create the test file so exists=true
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'utils.test.ts'), '// existing test', 'utf-8');
    const plan = makePlan('src/utils.ts', 'src/utils.test.ts');
    const writePlan = await buildTestWritePlan(dir, plan as any);
    const text = renderTestWritePlan(writePlan);
    expect(text).toContain('已存在，默认跳过');
  });
});

// ============================================================
// writeTests — selected filter branch
// ============================================================
describe('writeTests — selected filter', () => {
  it('skips files not in selected set', async () => {
    const dir = await makeDir();
    const plan = makePlan('src/a.ts', 'src/a.test.ts');
    const writePlan = await buildTestWritePlan(dir, plan as any);

    // selected set excludes the file
    const written = await writeTests(dir, writePlan, { selected: ['src/other.test.ts'] });
    expect(written).toHaveLength(0);
  });

  it('writes only selected files when selected is provided', async () => {
    const dir = await makeDir();
    // Plan with 2 files
    const multiPlan = {
      testCommand: 'npm test',
      detectedFramework: 'vitest',
      targets: [
        {
          module: 'src',
          coverageStatus: 'uncovered' as const,
          sourceFiles: ['src/a.ts', 'src/b.ts'],
          suggestedTestFiles: ['src/a.test.ts', 'src/b.test.ts'],
          estimatedLines: 10,
          priority: 1,
        },
      ],
    };
    const writePlan = await buildTestWritePlan(dir, multiPlan as any, { maxFiles: 2 });
    // Select only 'src/a.test.ts'
    const written = await writeTests(dir, writePlan, { selected: ['src/a.test.ts'] });
    expect(written.length).toBeLessThanOrEqual(1);
  });
});

// ============================================================
// writeTests — overwrite branch
// ============================================================
describe('writeTests — overwrite control', () => {
  it('skips file that already exists when overwrite=false (default)', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'src'), { recursive: true });
    const existingPath = join(dir, 'src', 'utils.test.ts');
    await writeFile(existingPath, '// existing test', 'utf-8');

    const plan = makePlan('src/utils.ts', 'src/utils.test.ts');
    const writePlan = await buildTestWritePlan(dir, plan as any);
    // The draft should show exists=true
    const written = await writeTests(dir, writePlan); // default overwrite=false
    // File already exists, so it should be skipped
    expect(written).toHaveLength(0);
  });

  it('overwrites existing file when overwrite=true', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'src'), { recursive: true });
    const existingPath = join(dir, 'src', 'utils.test.ts');
    await writeFile(existingPath, '// old content', 'utf-8');

    const plan = makePlan('src/utils.ts', 'src/utils.test.ts');
    const writePlan = await buildTestWritePlan(dir, plan as any);
    const written = await writeTests(dir, writePlan, { overwrite: true });
    // Should have written the file
    expect(written).toHaveLength(1);
    expect(written[0].verified).toBe(true);
    expect(written[0].bytes).toBeGreaterThan(0);
  });
});

// ============================================================
// buildTestWritePlan — maxFiles option
// ============================================================
describe('buildTestWritePlan — maxFiles', () => {
  it('limits files to maxFiles', async () => {
    const dir = await makeDir();
    const plan = {
      testCommand: 'npm test',
      detectedFramework: 'vitest',
      targets: [
        {
          module: 'src',
          coverageStatus: 'uncovered' as const,
          sourceFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
          suggestedTestFiles: ['src/a.test.ts', 'src/b.test.ts', 'src/c.test.ts'],
          estimatedLines: 10,
          priority: 1,
        },
      ],
    };
    const writePlan = await buildTestWritePlan(dir, plan as any, { maxFiles: 2 });
    expect(writePlan.tests).toHaveLength(2);
  });

  it('returns empty plan when targets list is empty', async () => {
    const dir = await makeDir();
    const plan = {
      testCommand: 'npm test',
      detectedFramework: 'vitest',
      targets: [],
    };
    const writePlan = await buildTestWritePlan(dir, plan as any);
    expect(writePlan.target).toBeNull();
    expect(writePlan.tests).toHaveLength(0);
  });

  it('picks specific module by name', async () => {
    const dir = await makeDir();
    const plan = {
      testCommand: 'npm test',
      detectedFramework: 'vitest',
      targets: [
        {
          module: 'src/auth',
          coverageStatus: 'uncovered' as const,
          sourceFiles: ['src/auth/login.ts'],
          suggestedTestFiles: ['src/auth/login.test.ts'],
          estimatedLines: 10,
          priority: 2,
        },
        {
          module: 'src/api',
          coverageStatus: 'uncovered' as const,
          sourceFiles: ['src/api/routes.ts'],
          suggestedTestFiles: ['src/api/routes.test.ts'],
          estimatedLines: 10,
          priority: 1,
        },
      ],
    };
    const writePlan = await buildTestWritePlan(dir, plan as any, { module: 'auth' });
    expect(writePlan.target?.module).toBe('src/auth');
  });
});

// ============================================================
// buildTestWritePlan — suggestFallbackTestFile (when suggestedTestFiles is short)
// ============================================================
describe('buildTestWritePlan — fallback test file naming', () => {
  it('generates fallback test file name when suggestedTestFiles is empty', async () => {
    const dir = await makeDir();
    const plan = {
      testCommand: 'npm test',
      detectedFramework: 'vitest',
      targets: [
        {
          module: 'src/utils',
          coverageStatus: 'uncovered' as const,
          sourceFiles: ['src/utils/format.ts'],
          suggestedTestFiles: [], // empty → triggers suggestFallbackTestFile
          estimatedLines: 10,
          priority: 1,
        },
      ],
    };
    const writePlan = await buildTestWritePlan(dir, plan as any);
    expect(writePlan.tests[0].file).toContain('format');
    expect(writePlan.tests[0].file).toContain('.test');
  });
});
