import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { loadProjectIndex, saveProjectIndex, scanProject } from '../src/core/scanner.js';
import { parseSourceText } from '../src/core/ast-parser.js';

const goAvailable = (() => {
  try { const r = parseSourceText('package main', { language: 'go' }); return !r.error; } catch { return false; }
})();

async function writeProjectFile(root: string, file: string, content: string) {
  const full = join(root, file);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

describe('scanProject index persistence', () => {
  (goAvailable ? it : it.skip)('scans Go project with AST-enhanced exports (S9)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-scan-go-'));
    try {
      await writeProjectFile(root, 'go.mod', 'module example.com/app\n\ngo 1.22');
      await writeProjectFile(root, 'main.go', [
        'package main',
        '',
        'import "fmt"',
        '',
        'func Greet(name string) string {',
        '\treturn fmt.Sprintf("Hello %s", name)',
        '}',
        '',
        'func main() {',
        '\tfmt.Println(Greet("world"))',
        '}',
      ].join('\n'));

      const result = await scanProject({ rootPath: root, deep: false, includeTests: false, maxFileSize: 256 * 1024 });

      expect(result.identity.language).toBe('go');
      expect(result.fileCount).toBeGreaterThanOrEqual(1);
      expect(result.index.modules.length).toBeGreaterThan(0);

      // Verify AST-parsed source files are included in modules
      const allExports = result.index.modules.flatMap(m => m.exports || []);
      const allImports = result.index.modules.flatMap(m => m.imports || []);
      expect(allExports.length + allImports.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  (goAvailable ? it : it.skip)('scans Python project with AST-enhanced exports (S9)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-scan-py-'));
    try {
      await writeProjectFile(root, 'main.py', [
        'import os',
        'from pathlib import Path',
        '',
        'def greet(name: str) -> str:',
        '    return f"Hello {name}"',
        '',
        'class Config:',
        '    def __init__(self, path: Path):',
        '        self.path = path',
      ].join('\n'));

      const result = await scanProject({ rootPath: root, deep: false, includeTests: false, maxFileSize: 256 * 1024 });

      expect(result.fileCount).toBeGreaterThanOrEqual(1);
      expect(result.index.modules.length).toBeGreaterThan(0);

      const allExports = result.index.modules.flatMap(m => m.exports || []);
      const allImports = result.index.modules.flatMap(m => m.imports || []);
      expect(allExports.length + allImports.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('builds cross-file call graph from TS project (S11)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-callgraph-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        dependencies: {},
        devDependencies: { typescript: '^5.7.0', vitest: '^2.1.0' },
      }));
      await writeProjectFile(root, 'tsconfig.json', '{}');
      // Module A (src/lib): exports compute
      await mkdir(join(root, 'src', 'lib'), { recursive: true });
      await writeProjectFile(root, 'src/lib/math.ts', [
        'function helper(x: number): number { return x * 2; }',
        'export function compute(x: number): number { return helper(x) + 1; }',
      ].join('\n'));
      // Module B (src/app): imports compute and calls it
      await writeProjectFile(root, 'src/app/main.ts', [
        "import { compute } from '../lib/math';",
        'export function run(val: number): number {',
        '  return compute(val) + compute(val + 1);',
        '}',
      ].join('\n'));

      const result = await scanProject({ rootPath: root, deep: false, includeTests: false, maxFileSize: 256 * 1024 });

      // Cross-file call graph should have call edges
      const callGraph = result.index.callGraph;
      expect(callGraph).toBeDefined();
      expect(callGraph!.length).toBeGreaterThan(0);

      // Should have cross-module edges: src/app calling compute from src/lib
      const crossCalls = callGraph!.filter(e => e.callee.includes('src/lib') && e.caller.includes('src/app'));
      expect(crossCalls.length).toBeGreaterThan(0);

      // Should have internal edges: compute calling helper within same module
      const internalCalls = callGraph!.filter(e => e.callee.includes('helper'));
      expect(internalCalls.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists file fingerprints for incremental scan (S11)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-fingerprint-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        devDependencies: { typescript: '^5.7.0' },
      }));
      await writeProjectFile(root, 'tsconfig.json', '{}');
      await writeProjectFile(root, 'src/lib.ts', 'export const VERSION = "1.0";\n');

      // First scan — should have fingerprints
      const result1 = await scanProject({ rootPath: root, deep: false, includeTests: false, maxFileSize: 256 * 1024 });
      expect(result1.index.fileFingerprints).toBeDefined();
      const fps = result1.index.fileFingerprints!;
      const fpKeys = Object.keys(fps);
      expect(fpKeys.length).toBeGreaterThanOrEqual(1);

      // Verify fingerprints are mtimeMs:size format
      for (const key of fpKeys.slice(0, 3)) {
        expect(fps[key]).toMatch(/^\d+:\d+$/);
      }

      // Second scan — should produce same fingerprints if files unchanged
      await saveProjectIndex(root, result1.index);
      const result2 = await scanProject({ rootPath: root, deep: false, includeTests: false, maxFileSize: 256 * 1024 });
      expect(result2.index.fileFingerprints).toBeDefined();
      const fps2 = result2.index.fileFingerprints!;
      // Same files should have same fingerprints
      for (const key of fpKeys.slice(0, 3)) {
        if (fps2[key]) expect(fps2[key]).toBe(fps[key]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('scans and round-trips a serializable project index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-scan-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        dependencies: { express: '^4.18.0' },
        devDependencies: { typescript: '^5.7.0', vitest: '^2.1.0' },
      }));
      await writeProjectFile(root, 'tsconfig.json', '{}');
      await writeProjectFile(root, 'src/api/routes.ts', [
        "import { getUser } from '../service/user';",
        "router.get('/users/:id', getUser);",
      ].join('\n'));
      await writeProjectFile(root, 'src/service/user.ts', 'export function getUser() { return null; }\n');

      const result = await scanProject({
        rootPath: root,
        deep: false,
        includeTests: false,
        maxFileSize: 256 * 1024,
      });

      expect(result.identity.language).toBe('typescript');
      expect(result.identity.framework).toBe('express');
      expect(result.fileCount).toBeGreaterThanOrEqual(2);
      expect(result.moduleCount).toBeGreaterThan(0);

      await saveProjectIndex(root, result.index);
      const loaded = await loadProjectIndex(root);

      expect(loaded).not.toBeNull();
      expect(loaded?.identity.language).toBe('typescript');
      expect(loaded?.dependencyGraph).toBeInstanceOf(Map);
      expect(loaded?.modules.length).toBe(result.index.modules.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
