// Unit tests for src/cli/startup.ts — detectProjectStartInfo & scanForSubProjects
import { describe, it, expect } from 'vitest';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { detectProjectStartInfo, scanForSubProjects } from '../src/cli/startup.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'icloser-startup-'));
  roots.push(d);
  return d;
}

import { afterAll } from 'vitest';
afterAll(async () => {
  for (const r of roots) try { await rm(r, { recursive: true, force: true }); } catch {}
});

describe('detectProjectStartInfo', () => {
  it('returns null for empty directory', async () => {
    const dir = await makeDir();
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).toBeNull();
  });

  it('detects Node.js project with dev script', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'my-app',
      scripts: { dev: 'vite', build: 'tsc' },
      dependencies: { react: '^18' },
    }));
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toContain('Node.js');
    expect(result!.args).toContain('dev');
    expect(result!.label).toContain('dev');
  });

  it('detects Node.js project with start script', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'server',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4' },
    }));
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.args).toContain('start');
  });

  it('detects Node.js with needsInstall when no node_modules', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { dev: 'vite' },
      dependencies: { lodash: '^4' },
    }));
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result!.needsInstall).toBe(true);
  });

  it('returns null for Node.js project with only build script', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'lib',
      scripts: { build: 'tsc', test: 'jest' },
    }));
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).toBeNull();
  });

  it('detects Spring Boot (Maven) project', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'pom.xml'), '<project><artifactId>api</artifactId></project>');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toContain('Spring Boot');
    expect(result!.args).toContain('spring-boot:run');
    expect(result!.needsInstall).toBe(false);
  });

  it('detects Java/Gradle project', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'build.gradle'), '// gradle build');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toContain('Gradle');
    expect(result!.args).toContain('bootRun');
  });

  it('detects Go project with main.go', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');
    await writeFile(path.join(dir, 'main.go'), 'package main\nfunc main() {}\n');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Go');
    expect(result!.args).toContain('.');
    expect(result!.command).toBe('go');
  });

  it('detects Rust project with Cargo.toml', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname = "app"\n');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Rust');
    expect(result!.command).toBe('cargo');
    expect(result!.args).toContain('run');
  });

  it('detects Docker Compose project', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'docker-compose.yml'), 'version: "3"\nservices:\n  app:\n    image: node\n');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Docker Compose');
    expect(result!.command).toBe('docker-compose');
  });

  it('detects Makefile project with run target', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'Makefile'), 'run:\n\tgo run .\n\nbuild:\n\tgo build\n');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Makefile');
    expect(result!.args).toContain('run');
  });

  it('detects .NET project (.csproj)', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'MyApp.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('.NET');
    expect(result!.command).toBe('dotnet');
  });

  it('detects Python Django project with manage.py', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'manage.py'), '#!/usr/bin/env python\n');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Python (Django)');
  });

  it('detects Python project with main.py', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'main.py'), 'print("hello")\n');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Python');
    expect(result!.args).toContain('main.py');
  });

  it('detects yarn package manager from yarn.lock', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'app', scripts: { dev: 'vite' }, dependencies: { react: '^18' },
    }));
    await writeFile(path.join(dir, 'yarn.lock'), '# yarn lockfile v1\n');
    const result = await detectProjectStartInfo(dir, fsp, path);
    expect(result).not.toBeNull();
    expect(result!.command).toBe('yarn');
    expect(result!.label).toContain('yarn');
  });
});

describe('scanForSubProjects', () => {
  it('returns empty array for empty dir', async () => {
    const dir = await makeDir();
    const result = await scanForSubProjects(dir, fsp, path);
    expect(result).toEqual([]);
  });

  it('detects sub-project in nested directory', async () => {
    const dir = await makeDir();
    const webDir = path.join(dir, 'web');
    await mkdir(webDir);
    await writeFile(path.join(webDir, 'package.json'), JSON.stringify({
      name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '^18' },
    }));
    const result = await scanForSubProjects(dir, fsp, path);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(r => r.dir === 'web')).toBe(true);
  });

  it('skips dot directories and node_modules', async () => {
    const dir = await makeDir();
    const gitDir = path.join(dir, '.git');
    await mkdir(gitDir);
    await writeFile(path.join(gitDir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    const nmDir = path.join(dir, 'node_modules');
    await mkdir(nmDir);
    await writeFile(path.join(nmDir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    const result = await scanForSubProjects(dir, fsp, path);
    expect(result).toEqual([]);
  });

  it('detects depth-2 nested sub-project', async () => {
    const dir = await makeDir();
    const pkgDir = path.join(dir, 'packages', 'ui');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: '@scope/ui', scripts: { dev: 'vite' }, dependencies: { vue: '^3' },
    }));
    const result = await scanForSubProjects(dir, fsp, path);
    expect(result.some(r => r.dir === 'packages/ui')).toBe(true);
  });

  it('includes cwd on each result', async () => {
    const dir = await makeDir();
    const apiDir = path.join(dir, 'api');
    await mkdir(apiDir);
    await writeFile(path.join(apiDir, 'go.mod'), 'module example.com/api\ngo 1.21\n');
    await writeFile(path.join(apiDir, 'main.go'), 'package main\nfunc main(){}\n');
    const result = await scanForSubProjects(dir, fsp, path);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].cwd).toBeDefined();
    expect(result[0].dir).toBe('api');
  });
});
