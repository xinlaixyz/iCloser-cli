import * as path from 'path';
import { renderChoicePanel } from './choice-panel.js';

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn';

export interface SystemOperationStep {
  label: string;
  command: string;
  args: string[];
  display: string;
  background?: boolean;
}

export interface SystemOperation {
  title: string;
  reason: string;
  impact: string;
  cwd: string;
  approvalKey: string;
  steps: SystemOperationStep[];
}

export interface StartProjectPackage {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function detectPackageManager(cwd: string): Promise<PackageManagerName> {
  if (await pathExists(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await pathExists(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function packageManagerCommand(packageManager: PackageManagerName): string {
  if (process.platform !== 'win32') return packageManager;
  return `${packageManager}.cmd`;
}

export function installArgs(packageManager: PackageManagerName): string[] {
  if (packageManager === 'yarn') return ['install'];
  return ['install'];
}

export function runArgs(packageManager: PackageManagerName, scriptName: string): string[] {
  if (packageManager === 'yarn') return [scriptName];
  return ['run', scriptName];
}

export function createStartProjectOperation(options: {
  cwd: string;
  pkg: StartProjectPackage;
  packageManager: PackageManagerName;
  scriptName: string;
  nodeModulesMissing: boolean;
}): SystemOperation {
  const { cwd, pkg, packageManager, scriptName, nodeModulesMissing } = options;
  const command = packageManagerCommand(packageManager);
  const hasDependencies = Object.keys(pkg.dependencies || {}).length > 0 ||
    Object.keys(pkg.devDependencies || {}).length > 0;
  const installFirst = nodeModulesMissing && hasDependencies;
  const steps: SystemOperationStep[] = [];

  if (installFirst) {
    steps.push({
      label: `${packageManager} install`,
      command,
      args: installArgs(packageManager),
      display: `${packageManager} install`,
    });
  }

  steps.push({
    label: `${packageManager} run ${scriptName}`,
    command,
    args: runArgs(packageManager, scriptName),
    display: `${packageManager} run ${scriptName}`,
    background: true,
  });

  return {
    title: '启动项目',
    reason: '用户要求启动当前项目，系统已识别到 package.json 启动脚本。',
    impact: installFirst ? '会先安装依赖，然后启动本地开发服务。' : '会启动本地开发服务。',
    cwd,
    approvalKey: `${packageManager} ${installFirst ? 'install + ' : ''}run ${scriptName}`,
    steps,
  };
}

export function renderSystemOperationApproval(operation: SystemOperation, platform = process.platform): string {
  const shellName = platform === 'win32' ? 'PowerShell' : 'Shell';
  const commandText = operation.steps.map(step => step.display).join(' && ');
  return renderChoicePanel({
    title: '系统权限确认',
    subtitle: `需要执行 ${shellName} 命令`,
    bodyLines: [
      `命令 ${commandText}`,
      `目录 ${operation.cwd}`,
      `操作 ${operation.title}`,
      '',
      `原因 ${operation.reason}`,
      `影响 ${operation.impact}`,
    ],
    options: [
      { id: 1, label: '允许执行一次' },
      { id: 2, label: `允许执行，并在本次会话记住：${operation.approvalKey}` },
      { id: 3, label: '取消' },
    ],
    hint: '下面输入框只接受 1 / 2 / 3，回车确认；不用输入命令。',
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const fsp = await import('fs/promises');
    await fsp.stat(filePath);
    return true;
  } catch {
    return false;
  }
}


