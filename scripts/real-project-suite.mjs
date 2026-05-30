#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const cases = [
  {
    name: 'AgentFI web build',
    cwd: process.env.IC_AGENTFI_WEB || 'D:\\temp\\Codex\\AgentFI\\agentfi-web',
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'build'],
    optional: true,
  },
  {
    name: 'AgentFI server tests',
    cwd: process.env.IC_AGENTFI_SERVER || 'D:\\temp\\Codex\\AgentFI\\agentfi-server',
    command: process.platform === 'win32' ? '.\\mvnw.cmd' : './mvnw',
    args: ['test'],
    optional: true,
  },
  {
    name: 'H5 sample smoke',
    cwd: process.env.IC_H5_SAMPLE || process.env.IC_AGENTFI_WEB || 'D:\\temp\\Codex\\AgentFI\\agentfi-web',
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'build'],
    optional: true,
  },
];

const results = [];
for (const c of cases) {
  if (!existsSync(c.cwd)) {
    results.push({ name: c.name, cwd: c.cwd, skipped: true, reason: 'path missing' });
    continue;
  }
  const started = Date.now();
  const r = spawnSync(c.command, c.args, { cwd: c.cwd, encoding: 'utf-8', timeout: 10 * 60 * 1000, shell: process.platform === 'win32' && c.command.startsWith('.\\') });
  results.push({
    name: c.name,
    cwd: c.cwd,
    command: `${c.command} ${c.args.join(' ')}`,
    exitCode: r.status,
    durationMs: Date.now() - started,
    ok: r.status === 0,
    stdoutTail: String(r.stdout || '').slice(-3000),
    stderrTail: String(r.stderr || '').slice(-1500),
  });
}

const ok = results.every(r => r.skipped || r.ok);
const outDir = path.join(repo, 'doc', 'real-project-suite');
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ ok, generatedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify({ ok, report: file, results: results.map(r => ({ name: r.name, ok: r.ok, skipped: r.skipped, exitCode: r.exitCode, durationMs: r.durationMs })) }, null, 2));
if (!ok) process.exitCode = 1;
