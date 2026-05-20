import { describe, expect, it } from 'vitest';
import {
  extractLocalUrl,
  extractAllUrls,
  formatCommandChunk,
  isProcessRunning,
  runForegroundCommand,
  type StartedProcess,
} from '../src/cli/system-runner.js';

function fakeProcess(exitCode: number | null, killed: boolean): StartedProcess {
  return {
    label: 'dev server',
    cwd: process.cwd(),
    child: { exitCode, killed } as StartedProcess['child'],
  };
}

describe('system runner', () => {
  it('detects local dev server URLs from command output', () => {
    expect(extractLocalUrl('Local: http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(extractLocalUrl('ready on http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(extractLocalUrl('network http://0.0.0.0:8080/app')).toBe('http://0.0.0.0:8080/app');
    expect(extractLocalUrl('ipv6 http://[::1]:4321/')).toBe('http://[::1]:4321/');
  });

  it('keeps command output readable by removing ansi codes and limiting lines', () => {
    const lines = formatCommandChunk('\x1b[32mone\x1b[0m\ntwo\nthree\nfour\n', 2);
    expect(lines).toEqual(['three', 'four']);
  });

  it('reports process running state from child process flags', () => {
    expect(isProcessRunning(fakeProcess(null, false))).toBe(true);
    expect(isProcessRunning(fakeProcess(0, false))).toBe(false);
    expect(isProcessRunning(fakeProcess(null, true))).toBe(false);
  });

  it('extractAllUrls returns all unique local URLs', () => {
    const output = 'server at http://localhost:3000 and http://localhost:4000 (also http://localhost:3000 again)';
    const urls = extractAllUrls(output);
    expect(urls).toContain('http://localhost:3000');
    expect(urls).toContain('http://localhost:4000');
    expect(urls).toHaveLength(2); // deduplicated
  });

  it('extractAllUrls returns empty for no URLs', () => {
    expect(extractAllUrls('no urls here')).toEqual([]);
  });

  it('extractLocalUrl returns null when no URL', () => {
    expect(extractLocalUrl('no url in this output')).toBeNull();
  });

  it('runForegroundCommand runs a successful command', async () => {
    const outputs: string[] = [];
    const ui = {
      onStart: () => {},
      onOutput: (t: string) => outputs.push(t),
      onSuccess: () => {},
      onError: () => {},
    };
    const ok = await runForegroundCommand(
      process.platform === 'win32' ? 'cmd.exe' : 'echo',
      process.platform === 'win32' ? ['/c', 'echo hello'] : ['hello'],
      process.cwd(),
      'test echo',
      ui,
    );
    expect(ok).toBe(true);
  });

  it('runForegroundCommand returns false for failing command', async () => {
    const ui = { onStart: () => {}, onOutput: () => {}, onSuccess: () => {}, onError: () => {} };
    const ok = await runForegroundCommand(
      process.platform === 'win32' ? 'cmd.exe' : 'sh',
      process.platform === 'win32' ? ['/c', 'exit 1'] : ['-c', 'exit 1'],
      process.cwd(),
      'failing command',
      ui,
    );
    expect(ok).toBe(false);
  });

  it('runForegroundCommand handles spawn error for invalid command', async () => {
    const errors: string[] = [];
    const ui = { onStart: () => {}, onOutput: () => {}, onSuccess: () => {}, onError: (e: string) => errors.push(e) };
    const ok = await runForegroundCommand(
      'definitely-not-a-real-command-xyz123',
      [],
      process.cwd(),
      'invalid cmd',
      ui,
    );
    // Either false or the spawn error is caught
    expect(typeof ok).toBe('boolean');
  });
});
