import { spawnSync } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const winPrefix = ['/d', '/s', '/c'];

const steps = [
  ['build', ['run', 'build'], 120000],
  ['test', ['run', 'test'], 180000],
  ['first-run', ['run', 'smoke:first-run'], 180000],
  ['repl', ['run', 'smoke:repl'], 180000],
  ['repl-apikey', ['run', 'smoke:repl:apikey'], 180000],
  ['repl-init', ['run', 'smoke:repl:init'], 180000],
  ['repl-e2e', ['run', 'smoke:repl:e2e'], 180000],
  ['memory', ['run', 'smoke:memory'], 180000],
  ['autopilot', ['run', 'smoke:autopilot'], 120000],
  ['repair', ['run', 'smoke:repair'], 180000],
  ['loop', ['run', 'smoke:loop'], 120000],
  ['multilang', ['run', 'smoke:multilang'], 120000],
  ['web-search', ['run', 'smoke:web-search'], 60000],
  ['agent', ['run', 'smoke:agent'], 60000],
  ['release', ['run', 'smoke'], 240000],
  ['project', ['run', 'smoke:project'], 240000],
];

function npmArgs(args) {
  return process.platform === 'win32' ? [...winPrefix, `npm ${args.join(' ')}`] : args;
}

function runStep(name, args, timeout) {
  process.stdout.write(`\n[smoke:all] ${name}: npm ${args.join(' ')}\n`);
  const result = spawnSync(npmCmd, npmArgs(args), {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf-8',
    timeout,
    shell: false,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status}`);
  }
}

try {
  for (const [name, args, timeout] of steps) {
    runStep(name, args, timeout);
  }
  process.stdout.write('\n[smoke:all] PASS all acceptance gates\n');
} catch (err) {
  process.stderr.write(`\n[smoke:all] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

