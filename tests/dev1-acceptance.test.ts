import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config.js';
import { createTask, addFileChange } from '../src/core/task-engine.js';
import { scanTaskSecurity } from '../src/core/security.js';
import type { ProjectIdentity } from '../src/types.js';

const identity: ProjectIdentity = {
  language: 'typescript',
  framework: 'unknown',
  database: 'unknown',
  buildSystem: 'npm',
  testFramework: 'vitest',
  runtime: 'node',
  deploymentType: 'unknown',
  packageManager: 'npm',
  languageVersion: 'unknown',
};

async function scanChangedFile(root: string, file: string, lines: string[]) {
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, file), lines.join('\n'), 'utf-8');

  const task = createTask(`accept ${file}`);
  addFileChange(task.id, {
    file,
    intent: 'acceptance',
    reasoning: 'dev1 acceptance regression',
    added: lines.length,
    removed: 0,
  });

  return scanTaskSecurity(root, task, defaultConfig(root, identity));
}

describe('dev1 security acceptance', () => {
  it('does not flag dangerousCommands config examples as executable commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-accept-'));
    try {
      const issues = await scanChangedFile(root, 'src/config.ts', [
        'export const security = {',
        '  dangerousCommands: [',
        '    "rm -rf /",',
        '    "git push --force",',
        '    "DROP TABLE",',
        '  ],',
        '};',
      ]);

      expect(issues.filter(issue => issue.category === 'dangerous-command')).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags real dangerous command text in source code', async () => {
    const cases = [
      {
        file: 'src/tools.ts',
        lines: ['export async function dangerousClean() {', '  await exec("rm -rf /");', '}'],
        ruleId: 'danger-rm-rf-root',
      },
      {
        file: 'src/db.ts',
        lines: ['export async function reset() {', '  await db.query("DROP TABLE users");', '}'],
        ruleId: 'danger-drop-database-object',
      },
      {
        file: 'src/deploy.ts',
        lines: ['export async function deploy() {', '  await exec("git push origin main --force");', '}'],
        ruleId: 'danger-git-push-force',
      },
    ];

    for (const testCase of cases) {
      const root = await mkdtemp(join(tmpdir(), 'icloser-accept-'));
      try {
        const issues = await scanChangedFile(root, testCase.file, testCase.lines);

        expect(issues).toContainEqual(expect.objectContaining({
          category: 'dangerous-command',
          ruleId: testCase.ruleId,
          line: 2,
        }));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});
