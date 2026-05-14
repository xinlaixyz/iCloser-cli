import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { detectProject } from '../src/utils/detect.js';

async function withTempProject(files: Record<string, string>, run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'icloser-detect-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, 'utf-8');
    }
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('detectProject', () => {
  it('detects a TypeScript npm project with Vitest', async () => {
    await withTempProject({
      'package.json': JSON.stringify({
        scripts: { build: 'tsc', test: 'vitest run' },
        devDependencies: { typescript: '^5.7.0', vitest: '^2.1.0' },
      }),
      'package-lock.json': '{}',
      'tsconfig.json': '{}',
      'index.ts': 'export const answer: number = 42;\n',
    }, async dir => {
      const identity = await detectProject(dir);
      expect(identity.language).toBe('typescript');
      expect(identity.buildSystem).toBe('npm');
      expect(identity.packageManager).toBe('npm');
      expect(identity.testFramework).toBe('vitest');
    });
  });

  it('detects a Go Gin PostgreSQL project', async () => {
    await withTempProject({
      'go.mod': [
        'module example.com/app',
        'go 1.22',
        'require github.com/gin-gonic/gin v1.10.0',
        'require github.com/jackc/pgx/v5 v5.7.0',
      ].join('\n'),
      'main.go': 'package main\n',
      'handler_test.go': 'package main\n',
    }, async dir => {
      const identity = await detectProject(dir);
      expect(identity.language).toBe('go');
      expect(identity.framework).toBe('gin');
      expect(identity.database).toBe('postgresql');
      expect(identity.buildSystem).toBe('go-mod');
      expect(identity.testFramework).toBe('go-test');
      expect(identity.languageVersion).toBe('1.22');
    });
  });
});
