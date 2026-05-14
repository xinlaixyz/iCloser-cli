import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  analyzeProjectAutopilot,
  planProjectTests,
  renderAutopilotReport,
  renderAutopilotTestPlan,
} from '../src/core/autopilot.js';

async function createReactProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-'));
  await mkdir(join(root, 'src', 'pages'), { recursive: true });
  await mkdir(join(root, 'src', 'components'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'demo-app',
    dependencies: { react: '^19.0.0' },
    devDependencies: { vitest: '^2.0.0', typescript: '^5.0.0' },
    scripts: { build: 'tsc', test: 'vitest run', dev: 'vite' },
  }, null, 2), 'utf-8');
  await writeFile(join(root, 'src', 'pages', 'Home.tsx'), 'export function Home() { return null; }\n', 'utf-8');
  await writeFile(join(root, 'src', 'pages', 'Settings.tsx'), 'export function Settings() { return null; }\n', 'utf-8');
  await writeFile(join(root, 'src', 'components', 'Button.tsx'), 'export function Button() { return null; }\n', 'utf-8');
  await writeFile(join(root, 'src', 'components', 'Button.test.tsx'), 'import { expect, it } from "vitest"; it("ok", () => expect(true).toBe(true));\n', 'utf-8');
  return root;
}

describe('project autopilot', () => {
  it('analyzes project shape and missing docs without writing files', async () => {
    const root = await createReactProject();
    try {
      const report = await analyzeProjectAutopilot(root);

      expect(report.identity.language).toBe('typescript');
      expect(report.summary.sourceFiles).toBeGreaterThanOrEqual(3);
      expect(report.summary.testFiles).toBe(1);
      expect(report.docs.missing).toContain('docs/PRD.md');
      expect(report.actions.map(action => action.id)).toContain('write-docs');
      expect(report.actions.map(action => action.id)).toContain('plan-tests');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renders beginner-readable next actions', async () => {
    const root = await createReactProject();
    try {
      const text = renderAutopilotReport(await analyzeProjectAutopilot(root));
      expect(text).toContain('项目工程自动分析');
      expect(text).toContain('发现的问题');
      expect(text).toContain('建议下一步');
      expect(text).toContain('补齐缺失文档');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('plans test gaps by module without writing test files', async () => {
    const root = await createReactProject();
    try {
      const plan = await planProjectTests(root);
      const pageTarget = plan.targets.find(target => target.module === 'src/pages');
      const componentTarget = plan.targets.find(target => target.module === 'src/components');

      expect(plan.detectedFramework).toBe('vitest');
      expect(plan.testCommand).toBe('npm run test');
      expect(plan.summary.missingModules).toBeGreaterThanOrEqual(1);
      expect(pageTarget?.coverageStatus).toBe('missing');
      expect(pageTarget?.suggestedTestFiles).toContain('src/pages/Home.test.tsx');
      expect(componentTarget?.coverageStatus).not.toBe('missing');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renders a Chinese test plan for non-technical users', async () => {
    const root = await createReactProject();
    try {
      const text = renderAutopilotTestPlan(await planProjectTests(root));
      expect(text).toContain('自动测试规划');
      expect(text).toContain('建议验证命令：npm run test');
      expect(text).toContain('优先补测模块');
      expect(text).toContain('下一步');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
