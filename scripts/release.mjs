/**
 * Release helper — bump version, run checks, tag, and push.
 *
 * Usage:
 *   node scripts/release.mjs [patch|minor|major|pre] [--dry]
 *
 * Examples:
 *   node scripts/release.mjs patch            # 0.1.0 → 0.1.1
 *   node scripts/release.mjs minor            # 0.1.0 → 0.2.0
 *   node scripts/release.mjs major            # 0.1.0 → 1.0.0
 *   node scripts/release.mjs pre --dry        # dry run, no git operations
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = process.cwd();
const PKG_PATH = resolve(ROOT, 'package.json');

const bump = process.argv[2];
const isDry = process.argv.includes('--dry');

if (!['patch', 'minor', 'major', 'pre'].includes(bump)) {
  console.error('Usage: node scripts/release.mjs <patch|minor|major|pre> [--dry]');
  process.exit(1);
}

// 1. Check working tree is clean
if (!isDry) {
  const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd: ROOT });
  if (status.trim()) {
    console.error('❌ Working tree is not clean. Commit or stash changes first.');
    process.exit(1);
  }
}

// 2. Read current version
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
const current = pkg.version;
// P2-21: strip pre-release suffix before parsing semver
const clean = current.split('-')[0];
const [major, minor, patch] = clean.split('.').map(Number);

// 3. Compute new version
let newVersion;
if (bump === 'pre') {
  const preSuffix = `-pre.${Date.now().toString(36)}`;
  newVersion = `${major}.${minor}.${patch}${preSuffix}`;
} else {
  const bumps = { major: [major + 1, 0, 0], minor: [major, minor + 1, 0], patch: [major, minor, patch + 1] };
  newVersion = bumps[bump].join('.');
}

console.log(`\n📦  ${current} → ${newVersion}\n`);

// 4. Check pre-flight
console.log('  [1/5] TypeScript check...');
try {
  execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8' });
  console.log('        ✓ Passed');
} catch (e) {
  console.error('        ❌ TypeScript errors found');
  console.error(e.stdout);
  process.exit(1);
}

console.log('  [2/5] Lint...');
try {
  execSync('npm run lint', { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8' });
  console.log('        ✓ Passed');
} catch {
  console.log('        ⚠ Lint warnings (non-blocking)');
}

console.log('  [3/5] Tests...');
try {
  execSync('npm test', { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8' });
  console.log('        ✓ Passed');
} catch (e) {
  console.error('        ❌ Tests failed');
  console.error(e.stdout?.slice(-500));
  process.exit(1);
}

console.log('  [4/5] Build...');
try {
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8' });
  console.log('        ✓ Passed');
} catch (e) {
  console.error('        ❌ Build failed');
  console.error(e.stderr?.slice(-500));
  process.exit(1);
}

// 5. Write version
if (!isDry) {
  pkg.version = newVersion;
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  console.log('        ✓ package.json updated');

  // 6. Commit, tag, push
  console.log('  [5/5] Git operations...');
  execSync(`git add package.json`, { cwd: ROOT });
  execSync(`git commit -m "release: v${newVersion}"`, { cwd: ROOT });
  execSync(`git tag -a v${newVersion} -m "v${newVersion}"`, { cwd: ROOT });
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  execSync(`git push origin ${branch} --follow-tags`, { cwd: ROOT });
  console.log(`        ✓ Pushed v${newVersion} — CI will publish automatically`);
} else {
  console.log('  [5/5] Dry run — skipping git operations');
}

console.log(`\n✅ Release v${newVersion} ${isDry ? '(dry run)' : 'triggered'}\n`);
