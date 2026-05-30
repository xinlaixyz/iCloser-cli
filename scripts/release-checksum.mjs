#!/usr/bin/env node
/**
 * RT-06: Release artifact checksums.
 * Generates SHA256 hashes for dist/ files.
 * Usage: node scripts/release-checksum.mjs
 */
import { createHash } from 'crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const root = process.cwd();
const distDir = path.join(root, 'dist');

try {
  const entries = readdirSync(distDir).filter(e => e.endsWith('.js') || e.endsWith('.mjs'));
  if (entries.length === 0) {
    console.log('No dist artifacts to checksum.');
    process.exit(0);
  }

  const checksums = [];
  for (const entry of entries.sort()) {
    const data = readFileSync(path.join(distDir, entry));
    const sha256 = createHash('sha256').update(data).digest('hex');
    checksums.push({ file: `dist/${entry}`, sha256, size: data.length });
  }

  const dateStamp = new Date().toISOString().replace(/T.*/, '');
  const dir = path.join(root, 'doc', 'release');
  mkdirSync(dir, { recursive: true });

  const manifest = {
    generated: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
    entries: checksums,
  };

  const file = path.join(dir, `CHECKSUMS_${dateStamp}.json`);
  writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`Release checksums: ${file}`);
  console.log(`  ${checksums.length} artifacts`);
  for (const c of checksums) console.log(`  ${c.file}  ${c.sha256.slice(0, 16)}...  ${c.size}B`);
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log('dist/ not found. Run npm run build first.');
  } else {
    console.error(`Checksum generation failed: ${err.message}`);
    process.exit(1);
  }
}
