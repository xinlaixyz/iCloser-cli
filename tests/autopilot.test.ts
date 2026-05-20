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

async function makeProject(extra?: (dir: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'tests'), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'test-project',
    scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
  }), 'utf-8');
  await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;\n', 'utf-8');
  await writeFile(join(root, 'src', 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }\n', 'utf-8');
  if (extra) await extra(root);
  return root;
}

async function makeReactProject() {
  const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-react-'));
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

describe('analyzeProjectAutopilot', () => {
  it('returns AutopilotReport with correct shape', async () => {
    const root = await makeProject();
    try {
      const report = await analyzeProjectAutopilot(root);
      expect(report.rootPath).toBe(root);
      expect(typeof report.identity.language).toBe('string');
      expect(Array.isArray(report.findings)).toBe(true);
      expect(Array.isArray(report.actions)).toBe(true);
      expect(Array.isArray(report.docs.required)).toBe(true);
      expect(Array.isArray(report.docs.missing)).toBe(true);
      expect(typeof report.summary.sourceFiles).toBe('number');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects missing required docs', async () => {
    const root = await makeProject();
    try {
      const report = await analyzeProjectAutopilot(root);
      expect(report.docs.missing.length).toBeGreaterThan(0);
      expect(report.docs.missing.some(d => d.includes('PRD'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes existing docs in existing list', async () => {
    const root = await makeProject(async (dir) => {
      await writeFile(join(dir, 'docs', 'README.md'), '# README\n\ncontent\n', 'utf-8');
    });
    try {
      const report = await analyzeProjectAutopilot(root);
      expect(report.docs.existing.some(d => d.includes('README'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects test files count', async () => {
    const root = await makeProject(async (dir) => {
      await writeFile(join(dir, 'tests', 'utils.test.ts'), 'import { add } from "../src/utils";\n', 'utf-8');
    });
    try {
      const report = await analyzeProjectAutopilot(root);
      expect(report.tests.detected).toBe(true);
      expect(report.summary.testFiles).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('suggests test plan when no test files', async () => {
    const root = await makeProject();
    try {
      const report = await analyzeProjectAutopilot(root);
      expect(report.tests.missingSuggestion).toContain('测试');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('actions include write-docs or analyze-only', async () => {
    const root = await makeProject();
    try {
      const report = await analyzeProjectAutopilot(root);
      const ids = report.actions.map(a => a.id);
      expect(ids.includes('write-docs') || ids.includes('analyze-only')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('analyzes react project and identifies missing docs and test gaps', async () => {
    const root = await makeReactProject();
    try {
      const report = await analyzeProjectAutopilot(root);
      expect(report.identity.language).toBe('typescript');
      expect(report.summary.sourceFiles).toBeGreaterThanOrEqual(3);
      expect(report.summary.testFiles).toBe(1);
      expect(report.docs.missing).toContain('docs/PRD.md');
      expect(report.actions.map(a => a.id)).toContain('write-docs');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('renderAutopilotReport', () => {
  it('renders all sections', async () => {
    const root = await makeProject();
    try {
      const text = renderAutopilotReport(await analyzeProjectAutopilot(root));
      expect(text).toContain('项目工程自动分析');
      expect(text).toContain(root);
      expect(text).toContain('建议下一步');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renders beginner-readable next actions for react project', async () => {
    const root = await makeReactProject();
    try {
      const text = renderAutopilotReport(await analyzeProjectAutopilot(root));
      expect(text).toContain('项目工程自动分析');
      expect(text).toContain('发现的问题');
      expect(text).toContain('建议下一步');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('planProjectTests', () => {
  it('returns AutopilotTestPlan with correct shape', async () => {
    const root = await makeProject();
    try {
      const plan = await planProjectTests(root);
      expect(plan.rootPath).toBe(root);
      expect(typeof plan.testCommand).toBe('string');
      expect(typeof plan.detectedFramework).toBe('string');
      expect(Array.isArray(plan.targets)).toBe(true);
      expect(typeof plan.summary.sourceModules).toBe('number');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks untested modules as missing', async () => {
    const root = await makeProject();
    try {
      const plan = await planProjectTests(root);
      const missing = plan.targets.filter(t => t.coverageStatus === 'missing');
      expect(missing.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks tested module as covered for react project', async () => {
    const root = await makeReactProject();
    try {
      const plan = await planProjectTests(root);
      expect(plan.detectedFramework).toBe('vitest');
      expect(plan.testCommand).toBe('npm run test');
      const componentTarget = plan.targets.find(t => t.module === 'src/components');
      expect(componentTarget?.coverageStatus).not.toBe('missing');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('page module has missing coverage in react project', async () => {
    const root = await makeReactProject();
    try {
      const plan = await planProjectTests(root);
      const pageTarget = plan.targets.find(t => t.module === 'src/pages');
      expect(pageTarget?.coverageStatus).toBe('missing');
      expect(pageTarget?.suggestedTestFiles).toContain('src/pages/Home.test.tsx');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('renderAutopilotTestPlan', () => {
  it('renders plan with all required sections', async () => {
    const root = await makeReactProject();
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

  it('renders non-empty output for basic project', async () => {
    const root = await makeProject();
    try {
      const text = renderAutopilotTestPlan(await planProjectTests(root));
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(50);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
