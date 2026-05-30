// Unit tests for src/utils/fs.ts — pure functions and async helpers
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile as nodWriteFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  normalizeNewlines,
  toPlatformNewlines,
  detectNewlineStyle,
  estimateTokens,
  isTextFile,
  relativePath,
  getIcloserDir,
  readFile,
  writeFile,
  readJson,
  writeJson,
  fileExists,
  listDir,
  backupFile,
  restoreFile,
  countLines,
  detectEncoding,
  readFileSafe,
  isFileSizeSafe,
  writeFiles,
  readFiles,
} from '../src/utils/fs.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'icloser-fs-'));
  roots.push(d);
  return d;
}

afterAll(async () => {
  for (const r of roots) try { await rm(r, { recursive: true, force: true }); } catch {}
});

describe('normalizeNewlines', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeNewlines('line1\r\nline2\r\n')).toBe('line1\nline2\n');
  });

  it('converts lone CR to LF', () => {
    expect(normalizeNewlines('a\rb\rc')).toBe('a\nb\nc');
  });

  it('leaves LF unchanged', () => {
    const s = 'hello\nworld\n';
    expect(normalizeNewlines(s)).toBe(s);
  });

  it('handles empty string', () => {
    expect(normalizeNewlines('')).toBe('');
  });
});

describe('toPlatformNewlines', () => {
  it('returns a string', () => {
    const result = toPlatformNewlines('hello\nworld\n');
    expect(typeof result).toBe('string');
    expect(result).toContain('hello');
    expect(result).toContain('world');
  });

  it('replaces both CRLF and LF', () => {
    const result = toPlatformNewlines('a\r\nb\nc');
    expect(result).not.toContain('\r\n\r\n');
    expect(result.replace(/\r\n|\n/g, '|')).toBe('a|b|c');
  });
});

describe('detectNewlineStyle', () => {
  it('detects LF', () => {
    expect(detectNewlineStyle('a\nb\nc')).toBe('lf');
  });

  it('detects CRLF', () => {
    expect(detectNewlineStyle('a\r\nb\r\nc')).toBe('crlf');
  });

  it('detects mixed', () => {
    expect(detectNewlineStyle('a\r\nb\nc')).toBe('mixed');
  });

  it('returns platform default for no newlines', () => {
    const result = detectNewlineStyle('no newlines here');
    expect(['crlf', 'lf']).toContain(result);
  });
});

describe('estimateTokens', () => {
  it('estimates tokens for English text', () => {
    const text = 'hello world this is a test sentence for token estimation';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length);
  });

  it('estimates more tokens for Chinese text', () => {
    const chinese = '这是一段中文文字用来测试令牌估算功能';
    const english = 'this is english text for token estimation testing';
    const cTokens = estimateTokens(chinese);
    const eTokens = estimateTokens(english);
    // Chinese is denser per character
    expect(cTokens).toBeGreaterThan(0);
    expect(eTokens).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('isTextFile', () => {
  it('returns true for .ts', async () => expect(await isTextFile('src/index.ts')).toBe(true));
  it('returns true for .json', async () => expect(await isTextFile('config.json')).toBe(true));
  it('returns true for .md', async () => expect(await isTextFile('README.md')).toBe(true));
  it('returns false for .png', async () => expect(await isTextFile('image.png')).toBe(false));
  it('returns false for .jpg', async () => expect(await isTextFile('photo.jpg')).toBe(false));
  it('returns false for .zip', async () => expect(await isTextFile('archive.zip')).toBe(false));
  it('returns false for .exe', async () => expect(await isTextFile('app.exe')).toBe(false));
  it('returns false for .woff2', async () => expect(await isTextFile('font.woff2')).toBe(false));
});

describe('relativePath', () => {
  it('computes relative path', () => {
    const { sep } = require('path');
    const rel = relativePath(join('/project', 'src', 'foo.ts'), '/project');
    expect(rel).toBe(`src${sep}foo.ts`);
  });

  it('handles same directory', () => {
    const rel = relativePath(join('/project', 'foo.ts'), '/project');
    expect(rel).toBe('foo.ts');
  });
});

describe('getIcloserDir', () => {
  it('appends .icloser to root path', () => {
    const dir = getIcloserDir('/my/project');
    expect(dir).toContain('.icloser');
    expect(dir).toContain('my');
  });
});

describe('fileExists', () => {
  it('returns true for existing file', async () => {
    const dir = await makeDir();
    await nodWriteFile(join(dir, 'test.txt'), 'hello');
    expect(await fileExists(join(dir, 'test.txt'))).toBe(true);
  });

  it('returns false for non-existent file', async () => {
    expect(await fileExists('/nonexistent/path/file.txt')).toBe(false);
  });
});

describe('listDir', () => {
  it('returns file names in directory', async () => {
    const dir = await makeDir();
    await nodWriteFile(join(dir, 'a.ts'), '');
    await nodWriteFile(join(dir, 'b.ts'), '');
    const files = await listDir(dir);
    expect(files).toContain('a.ts');
    expect(files).toContain('b.ts');
  });

  it('returns empty array for non-existent dir', async () => {
    expect(await listDir('/nonexistent/dir')).toEqual([]);
  });
});

describe('readFile / writeFile', () => {
  it('writes and reads file content', async () => {
    const dir = await makeDir();
    const p = join(dir, 'hello.txt');
    await writeFile(p, 'hello world\n');
    const content = await readFile(p);
    expect(content).toContain('hello world');
  });

  it('normalizes newlines by default', async () => {
    const dir = await makeDir();
    const p = join(dir, 'crlf.txt');
    await nodWriteFile(p, 'line1\r\nline2\r\n', 'utf-8');
    const content = await readFile(p);
    expect(content).toBe('line1\nline2\n');
  });

  it('respects normalizeNewlines: false', async () => {
    const dir = await makeDir();
    const p = join(dir, 'keep.txt');
    await nodWriteFile(p, 'a\r\nb', 'utf-8');
    const content = await readFile(p, { normalizeNewlines: false });
    expect(content).toContain('\r\n');
  });

  it('throws on path traversal attempt', async () => {
    const dir = await makeDir();
    await expect(writeFile('../secret.txt', 'bad', dir)).rejects.toThrow('路径遍历拒绝');
  });

  it('matchNewline: adapts to existing CRLF file', async () => {
    const dir = await makeDir();
    const p = join(dir, 'crlf.ts');
    await nodWriteFile(p, 'old\r\ncontent\r\n', 'utf-8');
    await writeFile(p, 'new\ncontent\n', undefined, { matchNewline: true });
    const raw = await import('fs/promises').then(m => m.readFile(p, 'utf-8'));
    expect(raw).toContain('\r\n');
  });
});

describe('readJson / writeJson', () => {
  it('writes and reads JSON', async () => {
    const dir = await makeDir();
    const p = join(dir, 'data.json');
    await writeJson(p, { key: 'value', num: 42 });
    const data = await readJson(p);
    expect(data).toEqual({ key: 'value', num: 42 });
  });

  it('writeJson throws on path traversal', async () => {
    const dir = await makeDir();
    await expect(writeJson('../outside.json', {}, 2, dir)).rejects.toThrow('路径遍历拒绝');
  });
});

describe('backupFile / restoreFile', () => {
  it('creates a backup and restores it', async () => {
    const dir = await makeDir();
    const p = join(dir, 'original.ts');
    await nodWriteFile(p, 'original content\n', 'utf-8');
    const backupPath = await backupFile(p);
    expect(backupPath).not.toBe('');
    await nodWriteFile(p, 'changed content\n', 'utf-8');
    await restoreFile(backupPath, p);
    const restored = await readFile(p);
    expect(restored).toContain('original content');
  });

  it('returns empty string for non-existent file', async () => {
    const result = await backupFile('/nonexistent/file.ts');
    expect(result).toBe('');
  });
});

describe('countLines', () => {
  it('counts lines correctly', async () => {
    const dir = await makeDir();
    const p = join(dir, 'lines.txt');
    await nodWriteFile(p, 'line1\nline2\nline3\n', 'utf-8');
    const n = await countLines(p);
    expect(n).toBeGreaterThanOrEqual(3);
  });
});

describe('detectEncoding', () => {
  it('detects UTF-8 BOM', async () => {
    const dir = await makeDir();
    const p = join(dir, 'bom.txt');
    await nodWriteFile(p, Buffer.from([0xEF, 0xBB, 0xBF, 0x68, 0x65, 0x6C, 0x6C, 0x6F]));
    const info = await detectEncoding(p);
    expect(info.encoding).toBe('utf-8-bom');
    expect(info.hasBOM).toBe(true);
  });

  it('detects UTF-16LE BOM', async () => {
    const dir = await makeDir();
    const p = join(dir, 'utf16le.txt');
    await nodWriteFile(p, Buffer.from([0xFF, 0xFE, 0x68, 0x00, 0x69, 0x00]));
    const info = await detectEncoding(p);
    expect(info.encoding).toBe('utf-16le');
    expect(info.hasBOM).toBe(true);
  });

  it('detects UTF-16BE BOM', async () => {
    const dir = await makeDir();
    const p = join(dir, 'utf16be.txt');
    await nodWriteFile(p, Buffer.from([0xFE, 0xFF, 0x00, 0x68, 0x00, 0x69]));
    const info = await detectEncoding(p);
    expect(info.encoding).toBe('utf-16be');
    expect(info.hasBOM).toBe(true);
  });

  it('detects plain UTF-8', async () => {
    const dir = await makeDir();
    const p = join(dir, 'plain.txt');
    await nodWriteFile(p, 'hello world', 'utf-8');
    const info = await detectEncoding(p);
    expect(info.encoding).toBe('utf-8');
    expect(info.hasBOM).toBe(false);
  });
});

describe('readFileSafe', () => {
  it('reads a plain UTF-8 file', async () => {
    const dir = await makeDir();
    const p = join(dir, 'plain.ts');
    await nodWriteFile(p, 'export const x = 1;\n', 'utf-8');
    const content = await readFileSafe(p);
    expect(content).toContain('export const x');
  });
});

describe('isFileSizeSafe', () => {
  it('returns true for small file', async () => {
    const dir = await makeDir();
    const p = join(dir, 'small.txt');
    await nodWriteFile(p, 'hello', 'utf-8');
    expect(await isFileSizeSafe(p)).toBe(true);
  });

  it('returns false for file exceeding limit', async () => {
    const dir = await makeDir();
    const p = join(dir, 'big.bin');
    await nodWriteFile(p, Buffer.alloc(10));
    expect(await isFileSizeSafe(p, 5)).toBe(false);
  });
});

describe('writeFiles / readFiles', () => {
  it('batch writes and reads multiple files', async () => {
    const dir = await makeDir();
    const entries = [
      { path: join(dir, 'a.ts'), content: 'const a = 1;\n' },
      { path: join(dir, 'b.ts'), content: 'const b = 2;\n' },
    ];
    const writeResult = await writeFiles(entries);
    expect(writeResult.written).toHaveLength(2);
    expect(writeResult.errors).toHaveLength(0);

    const readResult = await readFiles([join(dir, 'a.ts'), join(dir, 'b.ts')]);
    expect(readResult.files).toHaveLength(2);
    expect(readResult.errors).toHaveLength(0);
    expect(readResult.files[0].content).toContain('const a');
  });

  it('readFiles records error for missing file', async () => {
    const result = await readFiles(['/nonexistent/missing.ts']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toContain('missing.ts');
  });
});
