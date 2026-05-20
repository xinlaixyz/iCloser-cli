// File system utilities for iCloser Agent Shell
import fse from 'fs-extra';
import { readFile as nodeReadFile, writeFile as nodeWriteFile, stat as nodeStat, readdir as nodeReaddir } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import fastGlob from 'fast-glob';

export async function ensureDir(dir: string): Promise<void> {
  await fse.ensureDir(dir);
}

export async function readFile(filePath: string, options?: { encoding?: 'auto' | 'utf-8'; normalizeNewlines?: boolean; rootPath?: string }): Promise<string> {
  const enc = options?.encoding || 'utf-8';
  const normalize = options?.normalizeNewlines !== false; // default true
  if (options?.rootPath) {
    const resolved = path.resolve(filePath);
    const rel = path.relative(path.resolve(options.rootPath), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`路径遍历拒绝: ${filePath}`);
    }
  }
  let content: string;
  if (enc === 'auto') {
    content = await readFileSafe(filePath);
  } else {
    content = await nodeReadFile(filePath, 'utf-8');
  }
  return normalize ? normalizeNewlines(content) : content;
}

export async function writeFile(filePath: string, content: string, rootPath?: string, options?: { matchNewline?: boolean }): Promise<void> {
  const resolved = path.resolve(filePath);
  if (rootPath) {
    const rel = path.relative(path.resolve(rootPath), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`路径遍历拒绝: ${filePath}`);
    }
  } else if (resolved.includes('..')) {
    throw new Error(`路径遍历拒绝: ${filePath}`);
  }
  // Match existing newline style if possible (F10)
  let finalContent = content;
  if (options?.matchNewline) {
    try {
      const existing = await nodeReadFile(resolved, 'utf-8');
      const detected = detectNewlineStyle(existing);
      finalContent = detected === 'crlf' ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n');
    } catch { /* file is new, use platform default */ }
  }
  await fse.ensureDir(path.dirname(resolved));
  await nodeWriteFile(resolved, finalContent, 'utf-8');
}

export async function readJson(filePath: string, rootPath?: string): Promise<Record<string, unknown>> {
  if (rootPath) {
    const resolved = path.resolve(filePath);
    const rel = path.relative(path.resolve(rootPath), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`路径遍历拒绝: ${filePath}`);
    }
  }
  const content = await nodeReadFile(filePath, 'utf-8');
  return JSON.parse(content);
}

export async function writeJson(filePath: string, data: unknown, spaces = 2, rootPath?: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (rootPath) {
    const rel = path.relative(path.resolve(rootPath), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`路径遍历拒绝: ${filePath}`);
    }
  } else if (resolved.includes('..')) {
    throw new Error(`路径遍历拒绝: ${filePath}`);
  }
  await fse.ensureDir(path.dirname(resolved));
  await nodeWriteFile(resolved, JSON.stringify(data, null, spaces), 'utf-8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await nodeStat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listDir(dirPath: string): Promise<string[]> {
  if (!(await fileExists(dirPath))) return [];
  const entries = await nodeReaddir(dirPath, { withFileTypes: true });
  return entries.map(e => e.name);
}

export async function findFiles(
  rootPath: string,
  patterns: string[],
  ignorePatterns: string[] = ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'target/**', '__pycache__/**', '.next/**']
): Promise<string[]> {
  return fastGlob(patterns, {
    cwd: rootPath,
    ignore: ignorePatterns,
    absolute: true,
    dot: true, // include .github, .icloser, etc.
  });
}

export function relativePath(fullPath: string, rootPath: string): string {
  return path.relative(rootPath, fullPath);
}

export async function getFileSize(filePath: string): Promise<number> {
  const st = await nodeStat(filePath);
  return st.size;
}

export async function isTextFile(filePath: string): Promise<boolean> {
  const binaryExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.mp4', '.mp3', '.avi', '.mov', '.wmv',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.doc', '.xls',
  ];
  const ext = path.extname(filePath).toLowerCase();
  return !binaryExtensions.includes(ext);
}

export function getIcloserDir(rootPath: string): string {
  return path.join(rootPath, '.icloser');
}

export function getGlobalMemoryDir(): string {
  return path.join(
    process.env.HOME || process.env.USERPROFILE || os.homedir(),
    '.icloser',
    'global-memory'
  );
}

export async function backupFile(filePath: string): Promise<string> {
  if (!(await fileExists(filePath))) return '';
  const backupPath = `${filePath}.icloser-bak-${Date.now()}`;
  await fse.copy(filePath, backupPath);
  return backupPath;
}

export async function restoreFile(backupPath: string, originalPath: string): Promise<void> {
  if (await fileExists(backupPath)) {
    await fse.copy(backupPath, originalPath);
  }
}

export async function countLines(filePath: string): Promise<number> {
  const content = await readFile(filePath);
  return content.split('\n').length;
}

export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

// ============================================================
// Encoding detection & safe file I/O
// ============================================================

/** Detected encoding info from BOM or content analysis */
export interface EncodingInfo {
  encoding: 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'latin1';
  hasBOM: boolean;
}

/** Detect file encoding from BOM bytes. Returns 'utf-8' by default. */
export async function detectEncoding(filePath: string): Promise<EncodingInfo> {
  try {
    const buf = await nodeReadFile(filePath); // raw buffer
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      return { encoding: 'utf-8-bom', hasBOM: true };
    }
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      return { encoding: 'utf-16le', hasBOM: true };
    }
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
      return { encoding: 'utf-16be', hasBOM: true };
    }
    // Quick heuristic: if high bytes present, likely latin1/legacy
    let hiBytes = 0;
    for (let i = 0; i < Math.min(buf.length, 1024); i++) {
      if (buf[i] >= 0x80) hiBytes++;
    }
    if (hiBytes > Math.min(buf.length, 1024) * 0.3) {
      return { encoding: 'latin1', hasBOM: false };
    }
  } catch { /* fall through to default */ }
  return { encoding: 'utf-8', hasBOM: false };
}

/** Read file with auto-detected encoding. Falls back to UTF-8. */
export async function readFileSafe(filePath: string): Promise<string> {
  const enc = await detectEncoding(filePath);
  try {
    if (enc.encoding === 'utf-16le' || enc.encoding === 'utf-16be') {
      const buf = await nodeReadFile(filePath);
      return buf.toString(enc.encoding === 'utf-16le' ? 'utf16le' : 'utf16le');
    }
    if (enc.encoding === 'latin1') {
      const buf = await nodeReadFile(filePath);
      return buf.toString('latin1');
    }
  } catch { /* fall through */ }
  return nodeReadFile(filePath, 'utf-8');
}

// ============================================================
// Newline normalization
// ============================================================

/** Unify all newlines to LF */
export function normalizeNewlines(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Convert content to platform-native newlines */
export function toPlatformNewlines(content: string): string {
  const sep = process.platform === 'win32' ? '\r\n' : '\n';
  return content.replace(/\r?\n/g, sep);
}

/** Detect the primary newline style in content */
export function detectNewlineStyle(content: string): 'crlf' | 'lf' | 'mixed' {
  const crlf = (content.match(/\r\n/g) || []).length;
  const lf = (content.match(/(?<!\r)\n/g) || []).length;
  if (crlf > lf) return 'crlf';
  if (lf > crlf) return 'lf';
  if (crlf > 0 && lf > 0) return 'mixed';
  return process.platform === 'win32' ? 'crlf' : 'lf';
}

// ============================================================
// Batch file operations
// ============================================================

export interface FileEntry {
  path: string;
  content: string;
}

/** Batch write multiple files */
export async function writeFiles(entries: FileEntry[], rootPath?: string): Promise<{ written: string[]; errors: { path: string; error: string }[] }> {
  const written: string[] = [];
  const errors: { path: string; error: string }[] = [];
  for (const entry of entries) {
    try {
      await writeFile(entry.path, entry.content, rootPath);
      written.push(entry.path);
    } catch (err) {
      errors.push({ path: entry.path, error: (err as Error).message });
    }
  }
  return { written, errors };
}

/** Batch read multiple files */
export async function readFiles(paths: string[]): Promise<{ files: FileEntry[]; errors: { path: string; error: string }[] }> {
  const files: FileEntry[] = [];
  const errors: { path: string; error: string }[] = [];
  for (const p of paths) {
    try {
      files.push({ path: p, content: await readFile(p) });
    } catch (err) {
      errors.push({ path: p, error: (err as Error).message });
    }
  }
  return { files, errors };
}

/** Check if file exceeds max size, returns true if safe */
export async function isFileSizeSafe(filePath: string, maxBytes = 5 * 1024 * 1024): Promise<boolean> {
  const size = await getFileSize(filePath);
  return size <= maxBytes;
}

/** Read file in chunks, yields each chunk. For large file processing. */
export async function* readFileChunks(filePath: string, chunkSize = 64 * 1024): AsyncGenerator<string, void, void> {
  const fh = await import('fs/promises').then(m => m.open(filePath, 'r'));
  try {
    const buf = Buffer.alloc(chunkSize);
    let bytesRead: number;
    do {
      const result = await fh.read(buf, 0, chunkSize, null);
      bytesRead = result.bytesRead;
      if (bytesRead > 0) yield buf.slice(0, bytesRead).toString('utf-8');
    } while (bytesRead > 0);
  } finally {
    await fh.close();
  }
}
