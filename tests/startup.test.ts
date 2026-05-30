// P4-1: Startup / monorepo / dependency check tests
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tempDirs: string[] = [];

function mkdtemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icloser-startup-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('detectSubprojects (P3-1)', () => {
  it('returns empty for a directory with no project indicators', async () => {
    const dir = mkdtemp();
    const { detectSubprojects } = await import('../src/utils/detect.js');
    const subs = await detectSubprojects(dir);
    expect(subs).toEqual([]);
  });

  it('detects a Node.js subproject with package.json', async () => {
    const dir = mkdtemp();
    const subDir = path.join(dir, 'web');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'package.json'), JSON.stringify({
      name: 'web', scripts: { dev: 'vite', start: 'node server.js' },
      dependencies: { react: '^18.0.0' },
    }));

    const { detectSubprojects } = await import('../src/utils/detect.js');
    const subs = await detectSubprojects(dir);

    expect(subs.length).toBeGreaterThanOrEqual(1);
    const web = subs.find(s => s.name === 'web');
    expect(web).toBeDefined();
    expect(web!.language).toBe('TypeScript');
    expect(web!.buildFile).toBe('package.json');
    expect(web!.startCommand).toBe('npm run dev');
    expect(web!.framework).toBe('React');
  });

  it('detects a Java/Maven subproject with pom.xml', async () => {
    const dir = mkdtemp();
    const subDir = path.join(dir, 'server');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'pom.xml'), '<project><artifactId>server</artifactId></project>');

    const { detectSubprojects } = await import('../src/utils/detect.js');
    const subs = await detectSubprojects(dir);

    expect(subs.length).toBeGreaterThanOrEqual(1);
    const server = subs.find(s => s.name === 'server');
    expect(server).toBeDefined();
    expect(server!.language).toBe('Java');
    expect(server!.framework).toBe('Spring Boot');
    expect(server!.buildFile).toBe('pom.xml');
  });

  it('detects a Go subproject with go.mod', async () => {
    const dir = mkdtemp();
    const subDir = path.join(dir, 'api');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'go.mod'), 'module example.com/api\n\ngo 1.21');

    const { detectSubprojects } = await import('../src/utils/detect.js');
    const subs = await detectSubprojects(dir);

    expect(subs.length).toBeGreaterThanOrEqual(1);
    const api = subs.find(s => s.name === 'api');
    expect(api).toBeDefined();
    expect(api!.language).toBe('Go');
    expect(api!.buildFile).toBe('go.mod');
    expect(api!.startCommand).toBe('go run .');
  });

  it('detects monorepo with multiple subprojects (frontend + backend)', async () => {
    const dir = mkdtemp();
    // Frontend
    const webDir = path.join(dir, 'web');
    fs.mkdirSync(webDir);
    fs.writeFileSync(path.join(webDir, 'package.json'), JSON.stringify({
      name: 'web', scripts: { dev: 'vite' }, dependencies: { vue: '^3.0.0' },
    }));
    // Backend
    const serverDir = path.join(dir, 'server');
    fs.mkdirSync(serverDir);
    fs.writeFileSync(path.join(serverDir, 'go.mod'), 'module example.com/server\n\ngo 1.21');

    const { detectSubprojects } = await import('../src/utils/detect.js');
    const subs = await detectSubprojects(dir);

    expect(subs.length).toBeGreaterThanOrEqual(2);
    expect(subs.some(s => s.language === 'TypeScript')).toBe(true);
    expect(subs.some(s => s.language === 'Go')).toBe(true);
  });

  it('detects depth-2 nested subprojects (monorepo packages/)', async () => {
    const dir = mkdtemp();
    const packagesDir = path.join(dir, 'packages');
    fs.mkdirSync(packagesDir);
    const pkgDir = path.join(packagesDir, 'utils');
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: '@scope/utils', scripts: { build: 'tsc' },
    }));

    const { detectSubprojects } = await import('../src/utils/detect.js');
    const subs = await detectSubprojects(dir);

    expect(subs.length).toBeGreaterThanOrEqual(1);
    const utils = subs.find(s => s.name === 'packages/utils');
    expect(utils).toBeDefined();
    expect(utils!.buildFile).toBe('package.json');
  });

  it('skips dot-directories and node_modules', async () => {
    const dir = mkdtemp();
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'package.json'), '{}');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'package.json'), '{}');

    const { detectSubprojects } = await import('../src/utils/detect.js');
    const subs = await detectSubprojects(dir);

    expect(subs).toEqual([]);
  });
});

describe('REPL startup detection', () => {
  it('detects Android Gradle projects as install-and-launch flows, not Java bootRun', async () => {
    const dir = mkdtemp();
    fs.mkdirSync(path.join(dir, 'app', 'src', 'main'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'build.gradle.kts'), 'plugins { alias(libs.plugins.android.application) apply false }');
    fs.writeFileSync(path.join(dir, 'settings.gradle.kts'), 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }');
    fs.writeFileSync(path.join(dir, 'gradlew.bat'), '@echo off\r\n');
    fs.writeFileSync(path.join(dir, 'local.properties'), 'sdk.dir=C\\:\\\\Android\\\\sdk\n');
    fs.writeFileSync(path.join(dir, 'app', 'build.gradle.kts'), [
      'plugins { id("com.android.application") }',
      'android {',
      '  namespace = "com.example"',
      '  defaultConfig { applicationId = "com.example.app" }',
      '}',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'), '<manifest><application /></manifest>');

    const { detectProjectStartInfo } = await import('../src/cli/startup.js');
    const info = await detectProjectStartInfo(dir, fs.promises, path);

    expect(info).not.toBeNull();
    expect(info!.type).toBe('Android (Gradle)');
    expect(info!.label).toBe('Android assembleDebug + install + launch');
    expect(info!.background).toBe(false);
    expect(info!.args.join(' ')).toContain('assembleDebug');
    expect(info!.args.join(' ')).toContain('pm path android');
    expect(info!.args.join(' ')).toContain('install -r');
    expect(info!.args.join(' ')).toContain('com.example.app');
    expect(info!.args.join(' ')).not.toContain('bootRun');
  });
});

describe('checkDependencies (P3-3)', () => {
  it('reports Go project missing go.sum', async () => {
    const dir = mkdtemp();
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module test');

    const { checkDependencies } = await import('../src/utils/detect.js');
    const result = await checkDependencies(dir, { language: 'Go' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('go.sum');
  });

  it('reports Python project OK with no dependency file', async () => {
    const dir = mkdtemp();

    const { checkDependencies } = await import('../src/utils/detect.js');
    const result = await checkDependencies(dir, { language: 'Python' });

    expect(result.ok).toBe(true);
  });

  it('reports Rust project status (depends on cargo installed)', async () => {
    const dir = mkdtemp();

    const { checkDependencies } = await import('../src/utils/detect.js');
    const result = await checkDependencies(dir, { language: 'Rust' });

    // If cargo is installed, ok=true; if not, ok=false with helpful message
    if (result.ok) {
      expect(result.message).toContain('Cargo.lock');
    } else {
      expect(result.message).toContain('Cargo');
      expect(result.toolMissing).toBe('cargo');
    }
  });

  it('reports unknown language as OK', async () => {
    const dir = mkdtemp();

    const { checkDependencies } = await import('../src/utils/detect.js');
    const result = await checkDependencies(dir, { language: 'Elixir' });

    expect(result.ok).toBe(true);
  });
});

describe('analyzeStartupPlan', () => {
  it('returns null when projects array is empty', async () => {
    const { analyzeStartupPlan } = await import('../src/cli/startup-analysis.js');
    const mockProvider: any = { chat: async () => ({ content: '{}' }) };
    const result = await analyzeStartupPlan([], '/tmp/test', mockProvider, fs.promises, path);
    expect(result).toBeNull();
  });

  it('returns null when AI response is not valid JSON', async () => {
    const { analyzeStartupPlan } = await import('../src/cli/startup-analysis.js');
    const mockProvider: any = { chat: async () => ({ content: 'not json at all' }) };
    const dir = mkdtemp();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'web', scripts: { dev: 'node server.js' } }));
    const projects = [{ dir: 'web', cwd: dir, type: 'node', command: 'node', args: ['server.js'] }];
    const result = await analyzeStartupPlan(projects, dir, mockProvider, fs.promises, path);
    expect(result).toBeNull();
  });

  it('parses valid AI JSON response into StartupAnalysis', async () => {
    const { analyzeStartupPlan } = await import('../src/cli/startup-analysis.js');
    const dir = mkdtemp();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'api', scripts: { start: 'node server.js' } }));
    const projects = [{ dir: 'api', cwd: dir, type: 'node', command: 'node', args: ['server.js'] }];
    const validJson = JSON.stringify({
      services: [{ dir: 'api', verifiedCommand: 'node server.js', isServer: true, port: 3000, dependencies: [], warnings: [], prerequisites: [] }],
      suggestedOrder: ['api'],
      overallWarnings: [],
      confidence: 'high',
    });
    const mockProvider: any = { chat: async () => ({ content: validJson }) };
    const result = await analyzeStartupPlan(projects, dir, mockProvider, fs.promises, path);
    expect(result).not.toBeNull();
    expect(result!.services).toHaveLength(1);
    expect(result!.services[0].dir).toBe('api');
    expect(result!.services[0].isServer).toBe(true);
    expect(result!.confidence).toBe('high');
    expect(result!.suggestedOrder).toEqual(['api']);
  });

  it('filters out services with dirs not matching projects', async () => {
    const { analyzeStartupPlan } = await import('../src/cli/startup-analysis.js');
    const dir = mkdtemp();
    const projects = [{ dir: 'real-service', cwd: dir, type: 'node', command: 'node', args: [] }];
    const jsonWithUnknown = JSON.stringify({
      services: [
        { dir: 'real-service', verifiedCommand: 'node server.js', isServer: true, port: 8080, dependencies: [], warnings: [], prerequisites: [] },
        { dir: 'ghost-service', verifiedCommand: 'node ghost.js', isServer: false, dependencies: [], warnings: [], prerequisites: [] },
      ],
      suggestedOrder: ['real-service'],
      overallWarnings: [],
      confidence: 'medium',
    });
    const mockProvider: any = { chat: async () => ({ content: jsonWithUnknown }) };
    const result = await analyzeStartupPlan(projects, dir, mockProvider, fs.promises, path);
    expect(result).not.toBeNull();
    expect(result!.services).toHaveLength(1);
    expect(result!.services[0].dir).toBe('real-service');
  });

  it('returns null when AI throws', async () => {
    const { analyzeStartupPlan } = await import('../src/cli/startup-analysis.js');
    const dir = mkdtemp();
    const projects = [{ dir: 'web', cwd: dir, type: 'node', command: 'node', args: [] }];
    const mockProvider: any = { chat: async () => { throw new Error('AI unavailable'); } };
    const result = await analyzeStartupPlan(projects, dir, mockProvider, fs.promises, path);
    expect(result).toBeNull();
  });
});
