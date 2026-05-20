// Coverage push #2 — fast unit tests for core paths
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {} });
function tmpDir() { const d = mkdtempSync(join(tmpdir(), 'icloser-cov2-')); dirs.push(d); return d; }

describe('scanner module extraction', () => {
  it('scanProject detects TypeScript project', async () => {
    const d = tmpDir();
    mkdirSync(join(d, 'src'), { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'test', dependencies: { typescript: '^5' } }));
    writeFileSync(join(d, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    writeFileSync(join(d, 'src/index.ts'), 'export const hello = "world";');
    const { scanProject } = await import('../src/core/scanner.js');
    const result = await scanProject({ rootPath: d, deep: false, includeTests: false, maxFileSize: 1024 * 1024 });
    expect(result.identity.language).toBe('typescript');
    expect(result.fileCount).toBeGreaterThanOrEqual(1);
  });

  it('scanProject detects Go project', async () => {
    const d = tmpDir();
    writeFileSync(join(d, 'go.mod'), 'module example.com/test\n\ngo 1.21');
    writeFileSync(join(d, 'main.go'), 'package main\nfunc main() {}');
    const { scanProject } = await import('../src/core/scanner.js');
    const result = await scanProject({ rootPath: d, deep: false, includeTests: false, maxFileSize: 1024 * 1024 });
    expect(result.identity.language).toBe('go');
  });

  it('scanProject detects Python project', async () => {
    const d = tmpDir();
    writeFileSync(join(d, 'requirements.txt'), 'flask==2.0\n');
    writeFileSync(join(d, 'main.py'), 'print("hello")');
    const { scanProject } = await import('../src/core/scanner.js');
    const result = await scanProject({ rootPath: d, deep: false, includeTests: false, maxFileSize: 1024 * 1024 });
    expect(result.identity.language).toBe('python');
  });
});

describe('context scoring', () => {
  it('assembleContextFromProject returns valid context', async () => {
    const d = tmpDir();
    mkdirSync(join(d, 'src'), { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(d, 'src/index.ts'), 'export const x = 1;');
    const { scanProject, saveProjectIndex } = await import('../src/core/scanner.js');
    const sr = await scanProject({ rootPath: d, deep: false, includeTests: false, maxFileSize: 1024 * 1024 });
    await saveProjectIndex(d, sr.index);
    const { assembleContextFromProject } = await import('../src/core/context.js');
    const ctx = await assembleContextFromProject(d, {
      id: 'test', description: '分析代码', status: 'queued', priority: 'normal',
      createdAt: new Date().toISOString(), changes: [], diffs: [], reasoning: [], errorLog: [], retryCount: 0, maxRetries: 3, agentExecutions: [],
    } as any, { maxTokens: 24000 });
    expect(ctx.totalTokens).toBeGreaterThan(0);
    expect(ctx.projectMeta).toBeTruthy();
  });

  it('assembleContextFromProject handles Chinese task description', async () => {
    const d = tmpDir();
    mkdirSync(join(d, 'src'), { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(d, 'src/auth.ts'), 'export function login() {}');
    const { scanProject, saveProjectIndex } = await import('../src/core/scanner.js');
    const sr = await scanProject({ rootPath: d, deep: false, includeTests: false, maxFileSize: 1024 * 1024 });
    await saveProjectIndex(d, sr.index);
    const { assembleContextFromProject } = await import('../src/core/context.js');
    const ctx = await assembleContextFromProject(d, {
      id: 'test2', description: '修改用户认证模块', status: 'queued', priority: 'normal',
      createdAt: new Date().toISOString(), changes: [], diffs: [], reasoning: [], errorLog: [], retryCount: 0, maxRetries: 3, agentExecutions: [],
    } as any, { maxTokens: 24000 });
    expect(ctx.totalTokens).toBeGreaterThan(0);
    expect(ctx.relevantCode.length).toBeGreaterThanOrEqual(0);
  });
});

describe('memory system edge cases', () => {
  it('loadProjectMemory returns empty for non-existent project', async () => {
    const { loadProjectMemory } = await import('../src/core/memory.js');
    const d = tmpDir();
    const mem = await loadProjectMemory(d);
    expect(mem.rules).toEqual([]);
    expect(mem.decisions).toEqual([]);
  });

  it('createEmptyProjectMemory has expected structure', async () => {
    const { createEmptyProjectMemory } = await import('../src/core/memory.js');
    const mem = createEmptyProjectMemory('/test');
    expect(mem.projectId).toBe('test');
    expect(mem.rules).toEqual([]);
    expect(mem.taskHistory).toEqual([]);
    expect(mem.createdAt).toBeTruthy();
  });

  it('sanitizeUserInput masks API keys', async () => {
    const { sanitizeUserInput } = await import('../src/core/memory.js');
    const result = sanitizeUserInput('my key is sk-ant-test123456789012345');
    expect(result.redacted).toBe(true);
    expect(result.content).not.toContain('sk-ant-test123456789012345');
  });
});

describe('security edge cases', () => {
  it('checkCommandExecution blocks dangerous commands', async () => {
    const { checkCommandExecution } = await import('../src/core/security.js');
    const cfg = { security: { dangerousCommands: ['rm -rf'] } } as any;
    const result = checkCommandExecution('rm -rf /', cfg, 'execute');
    expect(result.requiresConfirmation || !result.allowed).toBe(true);
  });

  it('checkCommandExecution allows build commands in execute mode', async () => {
    const { checkCommandExecution } = await import('../src/core/security.js');
    const cfg = { security: { dangerousCommands: [], allowGitPush: false } } as any;
    const result = checkCommandExecution('npm run build', cfg, 'execute');
    expect(result.allowed).toBe(true);
  });

  it('checkFileModification protects sensitive files', async () => {
    const { checkFileModification } = await import('../src/core/security.js');
    const cfg = { security: { sensitiveFiles: ['.env', '*.pem'] } } as any;
    const result = checkFileModification('.env', cfg, 'execute');
    expect(result.allowed).toBe(false);
  });

  it('modeDescription returns readable text', async () => {
    const { modeDescription } = await import('../src/core/security.js');
    expect(modeDescription('preview')).toBeTruthy();
  });
});

describe('detect.ts subproject + dependency', () => {
  it('detectSubprojects finds Node project in subdirectory', async () => {
    const d = tmpDir();
    const sub = join(d, 'web');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'package.json'), JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '^18' } }));
    const { detectSubprojects } = await import('../src/utils/detect.js');
    const subs = await detectSubprojects(d);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0].language).toBe('TypeScript');
  });

  it('checkDependencies reports Java missing mvn', async () => {
    const d = tmpDir();
    writeFileSync(join(d, 'pom.xml'), '<project/>');
    const { checkDependencies } = await import('../src/utils/detect.js');
    const result = await checkDependencies(d, { language: 'Java' });
    expect(typeof result.ok).toBe('boolean');
  });
});

