#!/usr/bin/env node
/**
 * macOS developer-experience acceptance gate.
 *
 * This script is intentionally safe on non-macOS hosts: it reports the skipped
 * state and exits 0 so Windows/Linux developers can keep one release command.
 * On macOS it runs the minimum acceptance chain expected by the product docs.
 */
import { spawnSync } from 'child_process';
import { platform, tmpdir } from 'os';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const isMac = platform() === 'darwin';
const dryRun = process.argv.includes('--dry-run');
const ciSmoke = process.argv.includes('--ci-smoke');
const json = process.argv.includes('--json');
const noReport = process.argv.includes('--no-report');
const reportDirArg = process.argv.find(arg => arg.startsWith('--report-dir='));
const reportDir = path.resolve(reportDirArg?.split('=').slice(1).join('=') || process.env.ICLOSER_MACOS_REPORT_DIR || path.join(process.cwd(), 'doc', 'release'));
const startedAt = new Date();
const results = [];

const commands = [
  ['npm', ['run', 'build']],
  ['npx', ['tsc', '--noEmit']],
  ['npm', ['run', 'lint']],
  ['npm', ['test']],
  ['npm', ['run', 'smoke']],
  ['npm', ['run', 'smoke:tools']],
];
const ciSmokeCommands = [
  ['node', ['dist/index.js', '--help']],
  ['node', ['dist/index.js', 'setup', '--mock', '--json']],
  ['node', ['dist/index.js', 'provider', 'list', '--json']],
];

function localDateStamp(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function log(message) {
  if (!json) console.log(message);
}

function run(cmd, args) {
  const label = `${cmd} ${args.join(' ')}`;
  log(`\n$ ${label}`);
  if (dryRun) {
    results.push({ command: label, status: 'dry-run', exitCode: 0, durationMs: 0 });
    return;
  }
  const started = Date.now();
  const result = process.platform === 'win32'
    ? spawnSync(`${cmd} ${args.join(' ')}`, { stdio: 'inherit', shell: true })
    : spawnSync(cmd, args, { stdio: 'inherit' });
  results.push({ command: label, status: result.status === 0 ? 'pass' : 'fail', exitCode: result.status ?? 1, durationMs: Date.now() - started });
  if (result.status !== 0) {
    writeReport('fail');
    process.exit(result.status ?? 1);
  }
}

function writeReport(status, reason = '') {
  const finishedAt = new Date();
  const stamp = localDateStamp(finishedAt);
  const data = {
    kind: 'macos-acceptance',
    status,
    reason,
    platform: platform(),
    isMac,
    mode: ciSmoke ? 'ci-smoke' : 'full',
    dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    commands: (ciSmoke ? ciSmokeCommands : commands).map(([cmd, args]) => `${cmd} ${args.join(' ')}`),
    results,
  };
  if (noReport) {
    if (json) console.log(JSON.stringify(data, null, 2));
    return data;
  }
  const markdown = [
    `# macOS Acceptance Report ${stamp}`,
    '',
    `- Status: ${status}`,
    `- Platform: ${platform()}`,
    `- Mode: ${data.mode}`,
    reason ? `- Reason: ${reason}` : '',
    '',
    '| Command | Status | Exit | Duration |',
    '| --- | --- | ---: | ---: |',
    ...(results.length > 0 ? results : data.commands.map(command => ({ command, status: isMac ? 'pending' : 'skipped', exitCode: 0, durationMs: 0 })))
      .map(item => `| \`${item.command}\` | ${item.status} | ${item.exitCode} | ${item.durationMs}ms |`),
    '',
  ].filter(Boolean).join('\n');
  const targetFile = path.join(reportDir, `MACOS_ACCEPTANCE_${stamp}.md`);
  try {
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(targetFile, markdown, 'utf-8');
    data.report = targetFile;
  } catch (err) {
    const fallbackDir = path.join(tmpdir(), 'icloser-release');
    const fallbackFile = path.join(fallbackDir, path.basename(targetFile));
    mkdirSync(fallbackDir, { recursive: true });
    writeFileSync(fallbackFile, markdown + `\n\nFallback reason: ${err.message}\n`, 'utf-8');
    data.report = fallbackFile;
    data.reportFallbackReason = err.message;
  }
  if (json) console.log(JSON.stringify(data, null, 2));
  else if (data.report) console.log(`\nmacOS acceptance report: ${data.report}`);
  return data;
}

log('macOS acceptance gate');
log(`platform=${platform()}`);

if (!isMac) {
  log('SKIP: macOS acceptance must be executed on macOS or macos-latest CI.');
  log('Required chain:');
  for (const [cmd, args] of commands) log(`- ${cmd} ${args.join(' ')}`);
  writeReport('skipped', 'not macOS host');
  process.exit(0);
}

for (const [cmd, args] of (ciSmoke ? ciSmokeCommands : commands)) run(cmd, args);
writeReport('pass');
log('\nmacOS acceptance passed.');
