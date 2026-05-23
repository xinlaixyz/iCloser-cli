// src/commands/server.ts — ic start | ic stop commands
// Extracted from src/index.ts (architecture split)
// Registers: start | stop (dev server lifecycle)

import { Command } from 'commander';
import * as path from 'path';
import { success, fail, info, progress, printError } from '../cli/output.js';
import { shouldUseWindowsShell } from '../cli/system-runner.js';

export function registerServerCommands(program: Command): void {
  // ============================================================
  // ic start — launch project dev server
  // ============================================================
  program.command('start')
    .alias('serve')
    .description('启动项目开发服务/移动端应用（等同于 REPL /start）')
    .action(async () => {
      const cwd = process.cwd();
      try {
        const fsp = await import('fs/promises');
        const { detectProjectStartInfo } = await import('../cli/startup.js');
        const startInfo = await detectProjectStartInfo(cwd, fsp, path);
        if (!startInfo) fail('未找到可启动配置（支持 npm/Gradle Android/Maven/Go/Python/Rust/Docker 等）');

        const { spawn, spawnSync } = await import('child_process');
        if (startInfo.needsInstall) {
          progress(`安装依赖 ${startInfo.command} install...`);
          const install = spawnSync(startInfo.command, ['install'], { cwd, stdio: 'inherit', shell: shouldUseWindowsShell(startInfo.command), windowsHide: true });
          if ((install.status ?? 1) !== 0) fail('依赖安装失败，项目未启动');
        }

        progress(`启动 ${startInfo.label}...`);
        if (startInfo.background === false) {
          const child = spawnSync(startInfo.command, startInfo.args, { cwd, stdio: 'inherit', shell: shouldUseWindowsShell(startInfo.command), windowsHide: true });
          if ((child.status ?? 1) !== 0) fail(`启动命令失败：${startInfo.label}`);
          success(`已完成 ${startInfo.label}`);
          return;
        }

        const child = spawn(startInfo.command, startInfo.args, { cwd, stdio: 'inherit', shell: shouldUseWindowsShell(startInfo.command), detached: true, windowsHide: true });
        // Persist PID metadata so `ic stop` can kill the exact process with validation
        if (child.pid) {
          const { writeFile: fsPid, mkdir: fsMkdir } = await import('fs/promises');
          try {
            await fsMkdir(path.join(cwd, '.icloser'), { recursive: true });
            const meta = JSON.stringify({
              pid: child.pid,
              cwd,
              script: startInfo.label,
              startedAt: new Date().toISOString(),
            });
            await fsPid(path.join(cwd, '.icloser', 'dev-server.pid'), meta, 'utf-8');
          } catch { /* best-effort — not fatal */ }
        }
        child.unref();
        success(`已启动 ${startInfo.label}（后台运行，PID ${child.pid ?? '未知'}）`);
        info('使用 ic stop 停止后台服务');
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic stop — stop background dev server
  // ============================================================
  program.command('stop')
    .description('停止后台开发服务')
    .action(async () => {
      try {
        const cwd = process.cwd();
        const { readFile: fsRead, unlink } = await import('fs/promises');
        const pidFile = path.join(cwd, '.icloser', 'dev-server.pid');

        // Read the JSON metadata written by `ic start`; validate project cwd before trusting the PID
        let pid: number | null = null;
        try {
          const raw = await fsRead(pidFile, 'utf-8');
          const meta = JSON.parse(raw) as { pid?: unknown; cwd?: unknown; script?: unknown; startedAt?: unknown };
          if (typeof meta.cwd === 'string' && meta.cwd !== cwd) {
            info(`PID 文件归属目录不匹配（记录: ${meta.cwd}，当前: ${cwd}），取消停止操作`);
            return;
          }
          if (typeof meta.pid === 'number' && Number.isFinite(meta.pid) && meta.pid > 0) {
            pid = meta.pid;
          }
        } catch { /* pid file absent or malformed — server was never started or already cleaned up */ }

        if (!pid) {
          info('未找到后台服务记录（.icloser/dev-server.pid 不存在），无法精确停止');
          return;
        }

        try {
          if (process.platform === 'win32') {
            const { execFileSync } = await import('child_process');
            execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
          } else {
            process.kill(pid, 'SIGTERM');
          }
          try { await unlink(pidFile); } catch { /* ok */ }
          success(`已停止后台服务（PID ${pid}）`);
        } catch {
          // Process already exited — clean up stale pid file
          try { await unlink(pidFile); } catch { /* ok */ }
          info(`后台服务已停止或不存在（PID ${pid}）`);
        }
      } catch { info('停止操作未完成'); }
    });
}
