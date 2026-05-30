// Tests for src/core/scanner-worker.ts — run as an actual worker thread
import { describe, it, expect } from 'vitest';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, '../dist/core/scanner-worker.js');

function runWorker(task: object): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_PATH);
    w.on('message', (msg) => { resolve(msg); w.terminate(); });
    w.on('error', reject);
    w.postMessage(task);
  });
}

describe('scanner-worker (worker thread)', () => {
  it('extract-exports-regex: detects exported function', async () => {
    const content = `export function hello(name: string): string {\n  return name;\n}\n`;
    const result = await runWorker({ type: 'extract-exports-regex', file: 'src/foo.ts', relativeFile: 'src/foo.ts', content });
    expect(result.ok).toBe(true);
    const exports = result.data as any[];
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('hello');
    expect(exports[0].kind).toBe('function');
    expect(exports[0].file).toBe('src/foo.ts');
    expect(exports[0].line).toBe(1);
  });

  it('extract-exports-regex: detects exported class', async () => {
    const content = `export class MyService {\n  run() {}\n}\n`;
    const result = await runWorker({ type: 'extract-exports-regex', file: 'src/svc.ts', relativeFile: 'src/svc.ts', content });
    expect(result.ok).toBe(true);
    const exports = result.data as any[];
    expect(exports[0].name).toBe('MyService');
    expect(exports[0].kind).toBe('class');
  });

  it('extract-exports-regex: detects exported const', async () => {
    const content = `export const VERSION = '1.0.0';\n`;
    const result = await runWorker({ type: 'extract-exports-regex', file: 'src/ver.ts', relativeFile: 'src/ver.ts', content });
    expect(result.ok).toBe(true);
    const exports = result.data as any[];
    expect(exports[0].name).toBe('VERSION');
    expect(exports[0].kind).toBe('const');
  });

  it('extract-exports-regex: detects exported interface', async () => {
    const content = `export interface Config {\n  port: number;\n}\n`;
    const result = await runWorker({ type: 'extract-exports-regex', file: 'src/cfg.ts', relativeFile: 'src/cfg.ts', content });
    expect(result.ok).toBe(true);
    const exports = result.data as any[];
    expect(exports[0].name).toBe('Config');
    expect(exports[0].kind).toBe('interface');
  });

  it('extract-exports-regex: detects exported enum (maps to const kind)', async () => {
    const content = `export enum Status { OK, ERROR }\n`;
    const result = await runWorker({ type: 'extract-exports-regex', file: 'src/status.ts', relativeFile: 'src/status.ts', content });
    expect(result.ok).toBe(true);
    const exports = result.data as any[];
    expect(exports[0].name).toBe('Status');
    expect(exports[0].kind).toBe('const');
  });

  it('extract-exports-regex: handles async function', async () => {
    const content = `export async function fetchData(): Promise<void> {}\n`;
    const result = await runWorker({ type: 'extract-exports-regex', file: 'src/fetch.ts', relativeFile: 'src/fetch.ts', content });
    expect(result.ok).toBe(true);
    const exports = result.data as any[];
    expect(exports[0].name).toBe('fetchData');
    expect(exports[0].kind).toBe('function');
  });

  it('extract-exports-regex: handles re-export syntax', async () => {
    const content = `export { MyClass, helper } from './utils';\n`;
    const result = await runWorker({ type: 'extract-exports-regex', file: 'src/index.ts', relativeFile: 'src/index.ts', content });
    expect(result.ok).toBe(true);
    const exports = result.data as any[];
    expect(exports.some((e: any) => e.name === 'MyClass')).toBe(true);
    expect(exports.some((e: any) => e.name === 'helper')).toBe(true);
  });

  it('extract-exports-regex: returns empty array for no exports', async () => {
    const content = `const x = 1;\nfunction foo() {}\n`;
    const result = await runWorker({ type: 'extract-exports-regex', file: 'src/priv.ts', relativeFile: 'src/priv.ts', content });
    expect(result.ok).toBe(true);
    expect((result.data as any[]).length).toBe(0);
  });

  it('extract-imports-regex: detects ES module import', async () => {
    const content = `import { useState } from 'react';\n`;
    const result = await runWorker({ type: 'extract-imports-regex', file: 'src/app.ts', relativeFile: 'src/app.ts', content });
    expect(result.ok).toBe(true);
    const imports = result.data as any[];
    expect(imports[0].source).toBe('react');
    expect(imports[0].isExternal).toBe(true);
  });

  it('extract-imports-regex: detects local import', async () => {
    const content = `import { helper } from './utils';\n`;
    const result = await runWorker({ type: 'extract-imports-regex', file: 'src/a.ts', relativeFile: 'src/a.ts', content });
    expect(result.ok).toBe(true);
    const imports = result.data as any[];
    expect(imports[0].source).toBe('./utils');
    expect(imports[0].isExternal).toBe(false);
  });

  it('extract-imports-regex: returns empty for no imports', async () => {
    const content = `const x = 1;\n`;
    const result = await runWorker({ type: 'extract-imports-regex', file: 'src/x.ts', relativeFile: 'src/x.ts', content });
    expect(result.ok).toBe(true);
    expect((result.data as any[]).length).toBe(0);
  });

  it('returns error for unknown task type', async () => {
    const result = await runWorker({ type: 'unknown-op', file: 'src/x.ts', relativeFile: 'src/x.ts', content: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown task type');
  });
});
