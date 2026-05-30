// Build offline portable package
// Usage: node scripts/build-package.mjs
// Output: out/icloser-agent-shell-0.1.0-portable.zip (Windows)
//         out/icloser-agent-shell-0.1.0-portable.tar.gz (macOS/Linux)

import { execSync } from 'child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'out');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const NAME = `${PKG.name}-${PKG.version}-portable`;
const DIST_DIR = join(OUT, NAME);

console.log(`\n  Building offline package: ${NAME}\n`);

// Clean output
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

// 1. Build TypeScript
console.log('  [1/6] Compiling TypeScript...');
execSync('npx tsc', { cwd: ROOT, stdio: 'pipe' });
console.log('        ✓ dist/');

// 2. Copy dist
console.log('  [2/6] Copying dist/...');
copyDir(join(ROOT, 'dist'), join(DIST_DIR, 'dist'));
console.log('        ✓ dist/');

// 3. Copy runtime files
console.log('  [3/6] Copying assets...');
for (const dir of ['skills', 'templates']) {
  if (existsSync(join(ROOT, dir))) copyDir(join(ROOT, dir), join(DIST_DIR, dir));
}
console.log('        ✓ skills/ templates/');

// 4. Copy node_modules (offline — no npm install needed)
console.log('  [4/6] Copying node_modules/ (this may take a while)...');
copyDir(join(ROOT, 'node_modules'), join(DIST_DIR, 'node_modules'));
console.log('        ✓ node_modules/');

// 5. Create launcher scripts
console.log('  [5/6] Creating launchers...');

// Windows launcher
writeFileSync(join(DIST_DIR, 'ic.cmd'), `@echo off
set "IC_HOME=%~dp0"
set "PATH=%IC_HOME%node_modules\\.bin;%PATH%"
node "%IC_HOME%dist\\index.js" %*
`);
console.log('        ✓ ic.cmd');

// Unix launcher
writeFileSync(join(DIST_DIR, 'ic'), `#!/usr/bin/env bash
IC_HOME="$(cd "$(dirname "$0")" && pwd)"
export PATH="$IC_HOME/node_modules/.bin:$PATH"
exec node "$IC_HOME/dist/index.js" "$@"
`);
try {
  chmodSync(join(DIST_DIR, 'ic'), 0o755);
} catch {
  // Windows may ignore POSIX executable bits; the archive is still usable.
}
console.log('        ✓ ic');

// Copy install scripts
if (existsSync(join(ROOT, 'install.ps1'))) copyFile(join(ROOT, 'install.ps1'), join(DIST_DIR, 'install.ps1'));
if (existsSync(join(ROOT, 'install.sh'))) copyFile(join(ROOT, 'install.sh'), join(DIST_DIR, 'install.sh'));
if (existsSync(join(ROOT, 'package.json'))) copyFile(join(ROOT, 'package.json'), join(DIST_DIR, 'package.json'));
console.log('        ✓ install scripts');

// 6. Create archives
console.log('  [6/6] Creating archives...');

// zip (Windows)
try {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${DIST_DIR}\\*' -DestinationPath '${join(OUT, NAME + '.zip')}' -Force"`, { cwd: ROOT, stdio: 'ignore' });
  console.log(`        ✓ ${NAME}.zip`);
} catch {
  try {
    execSync(`tar -a -cf "${join(OUT, NAME + '.zip')}" -C "${OUT}" "${NAME}"`, { cwd: ROOT, stdio: 'pipe' });
    console.log(`        ✓ ${NAME}.zip`);
  } catch {
    console.log('        ! zip failed (try 7-Zip or WinRAR)');
  }
}

// tar.gz (macOS/Linux)
try {
  execSync(`tar -czf "${join(OUT, NAME + '.tar.gz')}" -C "${OUT}" "${NAME}"`, { cwd: ROOT, stdio: 'pipe' });
  console.log(`        ✓ ${NAME}.tar.gz`);
} catch {
  console.log('        ! tar.gz failed (tar not available)');
}

// Summary
const zipSize = existsSync(join(OUT, NAME + '.zip')) ? formatSize(statSync(join(OUT, NAME + '.zip')).size) : 'N/A';

console.log(`\n  ┌─ Package Ready ─────────────────────────────┐`);
console.log(`  │  ${OUT}/${NAME}.zip      ${zipSize}`);
console.log(`  │  ${OUT}/${NAME}.tar.gz`);
console.log(`  │`);
console.log(`  │  用户使用:`);
console.log(`  │    解压 → 运行 install 或直接使用 ic 命令`);
console.log(`  │    完全离线, 无需 npm install`);
console.log(`  └──────────────────────────────────────────────┘\n`);

// ── Helpers ──────────────────────────────────────────
function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true, force: true });
}

function copyFile(src, dest) {
  copyFileSync(src, dest);
}

function formatSize(bytes) {
  const n = typeof bytes === 'number' ? bytes : parseInt(bytes);
  if (isNaN(n)) return bytes;
  if (n > 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
