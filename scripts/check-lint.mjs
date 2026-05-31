import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const roots = ['src', 'tests', 'scripts'];
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const blockedPatterns = [
  { name: 'merge conflict marker', regex: /^(<<<<<<<|=======|>>>>>>>) /m },
  { name: 'mock edit residue', regex: /^\/\/ icloser mock edit: 以下修改导致了错误：\s*$/m },
];

async function collectFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.icloser') continue;
      out.push(...await collectFiles(full));
      continue;
    }

    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (allowedExtensions.has(ext)) out.push(full);
  }
  return out;
}

// Phase 1: Custom lint rules (merge markers, mock residues)
const files = [];
for (const name of roots) {
  try {
    files.push(...await collectFiles(join(root, name)));
  } catch {
    // Optional root in packaged or partial workspaces.
  }
}

const failures = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const pattern of blockedPatterns) {
    if (pattern.regex.test(text)) {
      failures.push(`${relative(root, file)}: ${pattern.name}`);
    }
  }
}

if (failures.length > 0) {
  console.error('custom lint failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`custom lint ok (${files.length} files checked)`);
}

// Phase 2: ESLint (if available)
try {
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx.cmd eslint src/ tests/'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
      })
    : spawnSync('npx', ['eslint', 'src/', 'tests/'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
      });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout?.trim()) console.log(result.stdout.trim());
    if (result.stderr?.trim()) console.error(result.stderr.trim());
    process.exitCode = result.status || 1;
  } else {
    const warningMatch = result.stdout?.match(/(\d+)\s+problems?\s+\(0 errors?,\s+(\d+)\s+warnings?\)/i);
    if (warningMatch) console.log(`eslint ok (${warningMatch[2]} warnings)`);
    else console.log('eslint ok');
  }
} catch (err) {
  if (err?.code === 'ENOENT') {
    console.log('eslint: not installed (run `ic local-tools` to install)');
  } else {
    console.error(`eslint failed: ${err?.message || String(err)}`);
    process.exitCode = 1;
  }
}
