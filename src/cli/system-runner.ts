import { spawn, execFileSync, type ChildProcess } from 'child_process';

export interface StartedProcess {
  label: string;
  child: ChildProcess;
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

/** P0-2: guard against spawn() synchronous throw (EMFILE, invalid args, etc.) */
function safeSpawn(command: string, args: string[], opts: Parameters<typeof spawn>[2]): ChildProcess | Error {
  try {
    return spawn(command, args, opts);
  } catch (err) {
    return err as Error;
  }
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
    const child = safeSpawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    if (child instanceof Error) {
      ui.onError(child.message);
      return resolve(false);
    }

    child.stdout?.on('data', chunk => {
      const text = String(chunk);
      ui.onOutput(text);
      import('../core/memory/integration.js').then(m => m.ingestShellOutput(cwd, text, false)).catch(() => {});
    });
    child.stderr?.on('data', chunk => {
      const text = String(chunk);
      ui.onOutput(text);
      import('../core/memory/integration.js').then(m => m.ingestShellOutput(cwd, text, true)).catch(() => {});
    });
    child.on('error', err => {
      ui.onError(err.message);
      import('../core/memory/integration.js').then(m => m.ingestShellOutput(cwd, err.message, true)).catch(() => {});
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
  const child = safeSpawn(command, args, {
    cwd,
    env: { ...process.env, BROWSER: 'none' },
    windowsHide: true,
    shell: process.platform === 'win32',
  });

  if (child instanceof Error) {
    ui.onError(`启动失败：${child.message}`);
    return;
  }

  const record: StartedProcess = { label, child, cwd, url: undefined };
  startedProcesses.push(record);

  let output = '';
  let settled = false;
  const settleAc = new AbortController();
  const finish = (kind: 'success' | 'error', message: string) => {
    if (settled) return;
    settled = true;
    settleAc.abort(); // Signal early exit from the settle wait
    if (kind === 'success') ui.onSuccess(message);
    else ui.onError(message);
  };
  const onChunk = (chunk: Buffer | string, isError = false) => {
    const text = String(chunk);
    output += text;
    ui.onOutput(text);
    import('../core/memory/integration.js').then(m => m.ingestShellOutput(cwd, text, isError)).catch(() => {});
    const url = extractLocalUrl(output);
    if (url) {
      record.url = url;
      finish('success', `项目已启动\n地址 ${url}\n进程在后台运行，退出 REPL 时会自动停止。`);
    }
  };

  child.stdout?.on('data', (chunk: Buffer | string) => onChunk(chunk, false));
  child.stderr?.on('data', (chunk: Buffer | string) => onChunk(chunk, true));
  child.on('error', err => {
    import('../core/memory/integration.js').then(m => m.ingestShellOutput(cwd, err.message, true)).catch(() => {});
    finish('error', `启动失败：${err.message}`);
  });
  child.on('close', code => {
    const index = startedProcesses.findIndex(proc => proc.child === child);
    if (index >= 0) startedProcesses.splice(index, 1);
    if (!settled) {
      finish(code === 0 ? 'success' : 'error', code === 0 ? '启动命令已执行完成' : `启动命令退出，代码 ${code}`);
    }
  });

  // P0-2: wait for settle or timeout, whichever comes first
  const settleTimer = setTimeout(() => {
    if (!settled && isProcessRunning(record)) {
      finish('success', '启动命令已在后台运行\n没有捕获到 URL，请查看上方输出；也可以打开 package.json 中 dev 脚本对应的默认端口。');
    }
  }, settleMs);

  // Clean up timer if process settles early
  child.once('close', () => clearTimeout(settleTimer));
  child.once('error', () => clearTimeout(settleTimer));
  settleAc.signal.addEventListener('abort', () => clearTimeout(settleTimer), { once: true });

  await new Promise<void>(resolve => {
    if (settled) { resolve(); return; }
    settleAc.signal.addEventListener('abort', () => resolve(), { once: true });
    setTimeout(() => resolve(), settleMs);
  });
}

export async function stopStartedProcess(proc: StartedProcess): Promise<void> {
  if (!isProcessRunning(proc)) return;
  try {
    if (process.platform === 'win32' && proc.child.pid) {
      execFileSync('taskkill', ['/PID', String(proc.child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
  } catch { /* best-effort — process may have already exited */ }
  // S3: Graceful shutdown — SIGTERM first, wait 5s, then SIGKILL
  try { proc.child.kill('SIGTERM'); } catch { /* best-effort */ }
  await new Promise<void>(resolve => setTimeout(resolve, 5000));
  if (isProcessRunning(proc)) {
    try { proc.child.kill('SIGKILL'); } catch { /* best-effort */ }
  }
}

// P1-14: guard fetch() and AbortSignal.timeout for Node < 18
let _fetchSupported: boolean | null = null;
function isFetchSupported(): boolean {
  if (_fetchSupported !== null) return _fetchSupported;
  _fetchSupported = typeof fetch === 'function';
  return _fetchSupported;
}

function safeAbortTimeout(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  } catch {}
  // Fallback: manual AbortController
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch {} }, ms);
  return ctrl.signal;
}

// S3: Health check — poll process liveness with timeout
export async function healthCheckProcess(
  proc: StartedProcess,
  timeoutMs = 30000,
  pollIntervalMs = 1000,
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessRunning(proc)) return false;
    if (proc.url && isFetchSupported()) {
      try {
        const signal = safeAbortTimeout(2000);
        if (signal) {
          const resp = await fetch(proc.url, { signal });
          if (resp.ok || resp.status < 500) return true;
        }
      } catch { /* best-effort */ }
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  return isProcessRunning(proc);
}

export function extractLocalUrl(output: string): string | null {
  // S4: Enhanced URL pattern — more host patterns, multiple matches
  const pattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):\d+[^\s),\]>]*/gi;
  const matches = [...output.matchAll(pattern)];
  return matches.length > 0 ? matches[0][0] : null;
}

export function extractAllUrls(output: string): string[] {
  const pattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):\d+[^\s),\]>]*/gi;
  return [...new Set([...output.matchAll(pattern)].map(m => m[0]))];
}

export function formatCommandChunk(text: string, maxLines = 12): string[] {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  return clean.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}
