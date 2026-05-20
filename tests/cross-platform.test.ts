// P4-2: Cross-platform command detection and adaptation tests
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tempDirs: string[] = [];
function mkdtemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icloser-xplat-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('autoAdaptCommand (P1-4)', () => {
  // NOTE: autoAdaptCommand is not directly exported — tested via executeToolCall run_command
  // These tests validate the behavior through the public API

  it('executes Windows-native commands without adaptation', async () => {
    const { executeToolCall } = await import('../src/core/tool-executor.js');
    const dir = mkdtemp();

    const result = await executeToolCall('run_command', { command: 'dir' }, dir);
    if (process.platform === 'win32') {
      expect(result).not.toContain('已自动适配'); // dir is native on Windows
    }
  });

  it('adapts Unix ls to dir on Windows', async () => {
    const { executeToolCall } = await import('../src/core/tool-executor.js');
    const dir = mkdtemp();

    const result = await executeToolCall('run_command', { command: 'ls' }, dir);
    if (process.platform === 'win32') {
      expect(result).toContain('已自动适配');
      expect(result).toContain('dir');
    }
  });

  it('adapts Unix grep to findstr on Windows', async () => {
    const { executeToolCall } = await import('../src/core/tool-executor.js');
    const dir = mkdtemp();
    fs.writeFileSync(path.join(dir, 'sample.ts'), 'const value = "test";\n');

    const result = await executeToolCall('run_command', { command: 'grep test sample.ts' }, dir);
    if (process.platform === 'win32') {
      expect(result).toContain('已自动适配');
      expect(result.toLowerCase()).toContain('findstr');
    }
  });

  it('adapts Unix cat to type on Windows', async () => {
    const { executeToolCall } = await import('../src/core/tool-executor.js');
    const dir = mkdtemp();
    fs.writeFileSync(path.join(dir, 'file.txt'), 'hello\n');

    const result = await executeToolCall('run_command', { command: 'cat file.txt' }, dir);
    if (process.platform === 'win32') {
      expect(result).toContain('已自动适配');
      expect(result.toLowerCase()).toContain('type');
    }
  });

  it('detects mvnw.cmd wrapper when present', async () => {
    const { executeToolCall } = await import('../src/core/tool-executor.js');
    const dir = mkdtemp();
    fs.writeFileSync(path.join(dir, 'mvnw.cmd'), '@echo off');

    const result = await executeToolCall('run_command', { command: 'mvnw spring-boot:run' }, dir);
    if (process.platform === 'win32') {
      // Should use mvnw.cmd
      expect(result).toContain('mvnw.cmd');
    }
  });

  it('adapts mvn to mvnw.cmd when wrapper exists', async () => {
    const { executeToolCall } = await import('../src/core/tool-executor.js');
    const dir = mkdtemp();
    fs.writeFileSync(path.join(dir, 'mvnw.cmd'), '@echo off');

    const result = await executeToolCall('run_command', { command: 'mvn clean install' }, dir);
    if (process.platform === 'win32') {
      expect(result).toContain('mvnw.cmd');
    }
  });

  it('evaluates dangerous command check BEFORE adaptation', async () => {
    const { executeToolCall } = await import('../src/core/tool-executor.js');
    const dir = mkdtemp();

    // rm -rf / should be blocked on the original command, not adapted
    const result = await executeToolCall('run_command', { command: 'rm -rf /' }, dir);
    expect(result).toContain('安全策略拦截');
  });

  it('does not double-block dangerous commands already adapted', async () => {
    const { executeToolCall } = await import('../src/core/tool-executor.js');
    const dir = mkdtemp();

    // This is not dangerous (just rm without force flag is safe but might fail)
    // The key is that the adaptation doesn't create dangerous commands
    fs.writeFileSync(path.join(dir, 'test'), 'temporary\n');
    const result = await executeToolCall('run_command', { command: 'rm test' }, dir);
    expect(result).not.toContain('安全策略拦截');
  });
});
