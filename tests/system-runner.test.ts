import { describe, expect, it } from 'vitest';
import {
  extractLocalUrl,
  formatCommandChunk,
  isProcessRunning,
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
});
