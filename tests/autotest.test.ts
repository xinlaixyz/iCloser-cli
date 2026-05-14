import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { planProjectTests } from '../src/core/autopilot.js';
import { buildTestWritePlan, renderTestWritePlan, writeTests } from '../src/core/autotest.js';

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'icloser-autotest-'));
  await mkdir(join(root, 'src', 'pages'), { recursive: true });
  await mkdir(join(root, 'src', 'components'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'demo-app',
    dependencies: { react: '^19.0.0' },
    devDependencies: { vitest: '^2.0.0', typescript: '^5.0.0' },
    scripts: { test: 'vitest run', build: 'tsc' },
  }, null, 2), 'utf-8');
  await writeFile(join(root, 'src', 'pages', 'Home.tsx'), 'export function Home() { return null; }\n', 'utf-8');
  await writeFile(join(root, 'src', 'components', 'Button.tsx'), 'export function Button() { return null; }\n', 'utf-8');
  await writeFile(join(root, 'src', 'components', 'Button.test.tsx'), 'import { it } from "vitest"; it("ok", () => {});\n', 'utf-8');
  return root;
}

describe('safe test writer', () => {
  it('builds a one-file write plan for the highest priority missing module', async () => {
    const root = await createProject();
    try {
      const testPlan = await planProjectTests(root);
      const writePlan = await buildTestWritePlan(root, testPlan);

      expect(writePlan.target?.module).toBe('src/pages');
      expect(writePlan.tests).toHaveLength(1);
      expect(writePlan.tests[0].file).toBe('src/pages/Home.test.tsx');
      expect(writePlan.tests[0].content).toContain('exports a usable module API');
      expect(writePlan.totalNew).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes tests with verified disk receipts', async () => {
    const root = await createProject();
    try {
      const testPlan = await planProjectTests(root);
      const writePlan = await buildTestWritePlan(root, testPlan);
      const written = await writeTests(root, writePlan);

      expect(written).toHaveLength(1);
      expect(written[0].verified).toBe(true);
      expect(written[0].bytes).toBeGreaterThan(50);
      expect(written[0].fullPath.endsWith(join('src', 'pages', 'Home.test.tsx'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renders a beginner-readable write plan', async () => {
    const root = await createProject();
    try {
      const writePlan = await buildTestWritePlan(root, await planProjectTests(root));
      const text = renderTestWritePlan(writePlan);

      expect(text).toContain('安全测试写入计划');
      expect(text).toContain('目标模块：src/pages');
      expect(text).toContain('建议验证命令：npm run test');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
