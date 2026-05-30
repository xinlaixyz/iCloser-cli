#!/usr/bin/env node
/**
 * Golden path smoke for the Claude Code replacement positioning.
 * It verifies first-run setup, memory manifest UX, diff explanation,
 * collaboration draft, and commit draft without network access.
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const root = mkdtempSync(path.join(tmpdir(), 'icloser-golden-'));
const cli = path.join(process.cwd(), 'dist', 'index.js');
const env = {
  ...process.env,
  ICLOSER_HOME: path.join(root, '.icloser-home'),
  XDG_CONFIG_HOME: path.join(root, '.xdg-config'),
  NODE_OPTIONS: '--no-warnings',
};

function run(command, args, cwd = root) {
  const label = `${command} ${args.join(' ')}`;
  console.log(`\n$ ${label}`);
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8', env });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status}`);
  }
  return result.stdout || '';
}

writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2), 'utf-8');
writeFileSync(path.join(root, 'index.js'), 'export function add(a, b) { return a + b; }\n', 'utf-8');
run('git', ['init']);
run('git', ['config', 'user.email', 'smoke@example.com']);
run('git', ['config', 'user.name', 'Smoke Test']);
run('git', ['add', '.']);
run('git', ['commit', '-m', 'init']);

run('node', [cli, 'setup', '--mock', '--json']);
run('node', [cli, 'init', '--json']);
const memEdit = run('node', [cli, 'mem', 'edit']);
if (!memEdit.includes('Agent Memory')) throw new Error('memory manifest was not created');
const memUsed = run('node', [cli, 'mem', 'used', '提升长期记忆体验']);
if (!memUsed.includes('本次采用记忆') && !memUsed.includes('没有命中')) throw new Error('memory preview did not render');

writeFileSync(path.join(root, 'index.js'), 'export function add(a, b) { return Number(a) + Number(b); }\n', 'utf-8');
const diff = run('node', [cli, 'diff', 'explain']);
if (!diff.includes('Diff Explain')) throw new Error('diff explain did not render');
const pr = run('node', [cli, 'pr', '--title', 'Golden path smoke']);
if (!pr.includes('PR Draft')) throw new Error('PR draft did not render');
const commit = run('node', [cli, 'commit-draft']);
if (!commit.includes('Commit Draft')) throw new Error('commit draft did not render');

console.log(`\ngolden path smoke passed: ${root}`);
