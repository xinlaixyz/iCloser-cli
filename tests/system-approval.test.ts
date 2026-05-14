import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  createStartProjectOperation,
  detectPackageManager,
  packageManagerCommand,
  renderSystemOperationApproval,
} from '../src/cli/system-approval.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('system operation approval', () => {
  it('renders PowerShell approval choices on Windows', () => {
    const operation = createStartProjectOperation({
      cwd: 'D:\\temp\\project',
      pkg: { scripts: { dev: 'vite' }, dependencies: { react: '^19.0.0' } },
      packageManager: 'npm',
      scriptName: 'dev',
      nodeModulesMissing: false,
    });

    const text = stripAnsi(renderSystemOperationApproval(operation, 'win32'));

    expect(text).toContain('系统权限确认');
    expect(text).toContain('需要执行 PowerShell 命令');
    expect(text).toContain('npm run dev');
    expect(text).toContain('请选择下一步');
    expect(text).toContain('[1] 允许执行一次');
    expect(text).toContain('[2] 允许执行，并在本次会话记住：npm run dev');
    expect(text).toContain('[3] 取消');
    expect(text).toContain('下面输入框只接受 1 / 2 / 3');
  });

  it('renders shell approval and install-first command chain on macOS/Linux', () => {
    const operation = createStartProjectOperation({
      cwd: '/Users/me/project',
      pkg: { scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } },
      packageManager: 'pnpm',
      scriptName: 'dev',
      nodeModulesMissing: true,
    });

    const text = stripAnsi(renderSystemOperationApproval(operation, 'darwin'));

    expect(text).toContain('需要执行 Shell 命令');
    expect(text).toContain('pnpm install && pnpm run dev');
    expect(operation.approvalKey).toBe('pnpm install + run dev');
    expect(operation.steps.map(step => step.display)).toEqual(['pnpm install', 'pnpm run dev']);
    expect(operation.steps[1].background).toBe(true);
  });

  it('detects package manager from lockfiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-pm-'));
    try {
      expect(await detectPackageManager(root)).toBe('npm');

      await writeFile(join(root, 'yarn.lock'), '', 'utf-8');
      expect(await detectPackageManager(root)).toBe('yarn');

      await writeFile(join(root, 'pnpm-lock.yaml'), '', 'utf-8');
      expect(await detectPackageManager(root)).toBe('pnpm');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps package manager executable cross-platform', () => {
    const current = packageManagerCommand('npm');
    if (process.platform === 'win32') expect(current).toBe('npm.cmd');
    else expect(current).toBe('npm');
  });
});
