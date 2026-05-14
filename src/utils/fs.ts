// File system utilities for iCloser Agent Shell
import fse from 'fs-extra';
import { readFile as nodeReadFile, writeFile as nodeWriteFile, stat as nodeStat, readdir as nodeReaddir } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import fastGlob from 'fast-glob';

export async function ensureDir(dir: string): Promise<void> {
  await fse.ensureDir(dir);
}

export async function readFile(filePath: string): Promise<string> {
  return nodeReadFile(filePath, 'utf-8');
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  await fse.ensureDir(path.dirname(filePath));
  await nodeWriteFile(filePath, content, 'utf-8');
}

export async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await nodeReadFile(filePath, 'utf-8');
  return JSON.parse(content);
}

export async function writeJson(filePath: string, data: unknown, spaces = 2): Promise<void> {
  await fse.ensureDir(path.dirname(filePath));
  await nodeWriteFile(filePath, JSON.stringify(data, null, spaces), 'utf-8');
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
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
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
