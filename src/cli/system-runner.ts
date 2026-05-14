import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'child_process';

export interface StartedProcess {
  label: string;
  child: ChildProcessWithoutNullStreams;
  cwd: string;
  url?: string;
}

export interface RunnerUi {
  onStart(label: string): void;
  onOutput(text: string): void;
  onSuccess(message: string): void;
  onError(message: string): void;
}

export function isProcessRunning(proc: StartedProcess): boolean {
  return proc.child.exitCode === null && !proc.child.killed;
}

export async function runForegroundCommand(
  command: string,
  args: string[],
  cwd: string,
  label: string,
  ui: RunnerUi
): Promise<boolean> {
  return new Promise(resolve => {
    ui.onStart(`执行 ${label}`);
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    child.stdout.on('data', chunk => ui.onOutput(String(chunk)));
    child.stderr.on('data', chunk => ui.onOutput(String(chunk)));
    child.on('error', err => {
      ui.onError(err.message);
      resolve(false);
    });
    child.on('close', code => resolve(code === 0));
  });
}

export async function startBackgroundCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  label: string;
  startedProcesses: StartedProcess[];
  ui: RunnerUi;
  settleMs?: number;
}): Promise<void> {
  const { command, args, cwd, label, startedProcesses, ui, settleMs = 8000 } = options;
  ui.onStart(`启动 ${label}`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, BROWSER: 'none' },
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  const record: StartedProcess = { label, child, cwd, url: undefined };
  startedProcesses.push(record);

  let output = '';
  let settled = false;
  const finish = (kind: 'success' | 'error', message: string) => {
    if (settled) return;
    settled = true;
    if (kind === 'success') ui.onSuccess(message);
    else ui.onError(message);
  };
  const onChunk = (chunk: Buffer | string) => {
    const text = String(chunk);
    output += text;
    ui.onOutput(text);
    const url = extractLocalUrl(output);
    if (url) {
      record.url = url;
      finish('success', `项目已启动\n地址 ${url}\n进程在后台运行，退出 REPL 时会自动停止。`);
    }
  };

  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);
  child.on('error', err => finish('error', `启动失败：${err.message}`));
  child.on('close', code => {
    const index = startedProcesses.findIndex(proc => proc.child === child);
    if (index >= 0) startedProcesses.splice(index, 1);
    if (!settled) {
      finish(code === 0 ? 'success' : 'error', code === 0 ? '启动命令已执行完成' : `启动命令退出，代码 ${code}`);
    }
  });

  await new Promise<void>(resolve => setTimeout(resolve, settleMs));
  if (!settled && isProcessRunning(record)) {
    finish('success', '启动命令已在后台运行\n没有捕获到 URL，请查看上方输出；也可以打开 package.json 中 dev 脚本对应的默认端口。');
  }
}

export async function stopStartedProcess(proc: StartedProcess): Promise<void> {
  if (!isProcessRunning(proc)) return;
  try {
    if (process.platform === 'win32' && proc.child.pid) {
      execFileSync('taskkill', ['/PID', String(proc.child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
  } catch {}
  try { proc.child.kill('SIGTERM'); } catch {}
}

export function extractLocalUrl(output: string): string | null {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s)]*/i);
  return match?.[0] || null;
}

export function formatCommandChunk(text: string, maxLines = 12): string[] {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  return clean.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}
