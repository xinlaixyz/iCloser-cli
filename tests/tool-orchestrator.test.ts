import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildToolPlan,
  classifyFailure,
  classifyOrchestratorIntent,
  runToolOrchestrator,
} from '../src/core/tool-orchestrator.js';
import { ExecutionMemory } from '../src/core/execution-memory.js';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'icloser-orch-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'orch-fixture',
    scripts: { dev: 'node src/index.js', test: 'node --test' },
  }, null, 2));
  writeFileSync(join(dir, 'src/index.js'), 'console.log("ready");\n');
  return dir;
}

function multiModuleFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'icloser-orch-multi-'));
  mkdirSync(join(dir, 'agentfi-web'), { recursive: true });
  mkdirSync(join(dir, 'agentfi-server'), { recursive: true });
  mkdirSync(join(dir, 'database'), { recursive: true });
  writeFileSync(join(dir, 'agentfi-web', 'package.json'), JSON.stringify({
    name: 'agentfi-web',
    scripts: { dev: 'vite', build: 'tsc && vite build' },
    dependencies: { vite: '^5.0.0' },
  }, null, 2));
  writeFileSync(join(dir, 'agentfi-server', 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion></project>');
  writeFileSync(join(dir, 'agentfi-server', process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'), '');
  writeFileSync(join(dir, 'database', 'docker-compose.yml'), 'services:\n  db:\n    image: postgres:16\n');
  return dir;
}

describe('tool orchestrator', () => {
  it('classifies high-frequency engineering intents', () => {
    expect(classifyOrchestratorIntent('启动项目')).toBe('launch');
    expect(classifyOrchestratorIntent('修复测试失败')).toBe('bugfix');
    expect(classifyOrchestratorIntent('添加登录功能')).toBe('feature');
    expect(classifyOrchestratorIntent('解释 diff 风险')).toBe('explain');
    expect(classifyOrchestratorIntent('发布检查')).toBe('release');
    expect(classifyOrchestratorIntent('整理项目记忆')).toBe('memory');
  });

  it('builds a launch plan with dry-run command by default', async () => {
    const dir = fixture();
    try {
      const plan = await buildToolPlan(dir, '启动项目');
      expect(plan.some(step => step.tool === 'get_project_overview')).toBe(true);
      const commandStep = plan.find(step => step.tool === 'run_command' && String(step.title).includes('启动'));
      expect(commandStep?.args.dryRun).toBe(true);
      expect(String(commandStep?.args.command)).toContain('npm run dev');
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may briefly hold scanner files */ }
    }
  });

  it('discovers runnable subprojects when the repository root has no package.json', async () => {
    const dir = multiModuleFixture();
    try {
      const plan = await buildToolPlan(dir, '启动项目');
      const titles = plan.map(step => step.title).join('\n');
      expect(titles).toContain('agentfi-web');
      expect(titles).toContain('agentfi-server');
      expect(plan.some(step => String(step.args.command || '').includes('--prefix agentfi-web run dev'))).toBe(true);
      expect(plan.some(step => String(step.args.command || '').includes('agentfi-server'))).toBe(true);
      expect(plan.some(step => String(step.args.command || '').includes('-f database/docker-compose.yml up'))).toBe(true);
      expect(plan.some(step => step.args.path === 'package.json')).toBe(false);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may briefly hold scanner files */ }
    }
  });

  it('runs launch orchestration and records execution memory', async () => {
    const dir = fixture();
    try {
      const events: string[] = [];
      const result = await runToolOrchestrator({
        rootPath: dir,
        task: '启动项目',
        onProgress: event => events.push(event.phase),
      });
      expect(result.intent).toBe('launch');
      expect(result.executedSteps).toBeGreaterThan(0);
      expect(result.plan.some(step => step.status === 'success')).toBe(true);
      expect(result.memory.records.length).toBeGreaterThan(0);
      expect(events).toContain('plan');
      expect(events).toContain('done');
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may briefly hold scanner files */ }
    }
  });

  it('treats max-step limited runs as partial completion instead of failure when attempted steps pass', async () => {
    const dir = fixture();
    try {
      const result = await runToolOrchestrator({
        rootPath: dir,
        task: '发布检查',
        maxSteps: 2,
      });
      expect(result.success).toBe(true);
      expect(result.executedSteps).toBe(2);
      expect(result.summary).toContain('部分完成');
      expect(result.plan.some(step => step.status === 'pending')).toBe(true);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may briefly hold scanner files */ }
    }
  });

  it('classifies common failure categories for recover policy', () => {
    expect(classifyFailure('bash: Get-ChildItem: command not found')).toBe('command-not-found');
    expect(classifyFailure('FATAL Broken AVD system path. Check ANDROID_SDK_ROOT')).toBe('missing-sdk');
    expect(classifyFailure('Access is denied EPERM')).toBe('permission-denied');
    expect(classifyFailure('Vitest failed 1 test')).toBe('test-failed');
    expect(classifyFailure('BUILD FAILED in 2s')).toBe('build-failed');
    expect(classifyFailure('spawnSync cmd.exe ETIMEDOUT')).toBe('timeout');
    expect(classifyFailure('Android SDK not found. Set ANDROID_HOME')).toBe('missing-sdk');
    expect(classifyFailure('System images: C:\\Android\\sdk\\system-images\\android-35\nList of devices attached')).toBe('none');
    expect(classifyFailure('[DRY-RUN] powershell -NoProfile -Command "$env:ANDROID_HOME"\n目录: D:\\temp\\Codex\\Polymarket\n✅ 安全策略通过')).toBe('none');
  });

  it('deduplicates execution memory facts', () => {
    const memory = new ExecutionMemory();
    memory.addFact('项目是 Android Gradle');
    memory.addFact('项目是 Android Gradle');
    memory.addFailure('adb 无设备');
    const snap = memory.snapshot();
    expect(snap.facts).toEqual(['项目是 Android Gradle']);
    expect(snap.failures).toEqual(['adb 无设备']);
  });
});
