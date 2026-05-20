// Memory Kernel debug logger — provides consistent diagnostics
// Controlled by ICLOSER_MEMORY_DEBUG env var.
// Levels: 'off' | 'error' | 'warn' | 'info'
//   ICLOSER_MEMORY_DEBUG=warn  → only errors and warnings
//   ICLOSER_MEMORY_DEBUG=info  → verbose recall traces
//   unset or empty             → silent (default; set ICLOSER_MEMORY_DEBUG=error to enable)

type DebugLevel = 'off' | 'error' | 'warn' | 'info';

const envLevel = (process.env.ICLOSER_MEMORY_DEBUG || 'off').toLowerCase() as DebugLevel;
const levels: DebugLevel[] = ['off', 'error', 'warn', 'info'];
const threshold = levels.indexOf(envLevel);

function shouldLog(level: DebugLevel): boolean {
  return levels.indexOf(level) <= threshold;
}

let errorCount = 0;
let warnCount = 0;
let lastError: { time: string; msg: string } | null = null;

export const memdbg = {
  error(component: string, msg: string, err?: unknown): void {
    errorCount++;
    const detail = err instanceof Error ? err.message : String(err || '');
    lastError = { time: new Date().toISOString(), msg: `${component}: ${msg}${detail ? ' — ' + detail : ''}` };
    if (shouldLog('error')) {
      const line = `[mem:${component}] ERROR: ${msg}${detail ? ' — ' + detail : ''}`;
      process.stderr.write(`\x1b[31m${line}\x1b[0m\n`);
    }
  },

  warn(component: string, msg: string): void {
    warnCount++;
    if (shouldLog('warn')) {
      process.stderr.write(`[mem:${component}] WARN: ${msg}\n`);
    }
  },

  info(component: string, msg: string): void {
    if (shouldLog('info')) {
      process.stderr.write(`[mem:${component}] ${msg}\n`);
    }
  },

  /** Get diagnostic summary for CLI display */
  summary(): { errorCount: number; warnCount: number; lastError: string | null } {
    return {
      errorCount,
      warnCount,
      lastError: lastError ? lastError.msg : null,
    };
  },

  /** Reset counters (e.g. on session restart) */
  reset(): void {
    errorCount = 0;
    warnCount = 0;
    lastError = null;
  },
};
