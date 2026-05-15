import { describe, expect, it } from 'vitest';
import { isWriteIntendedInput, normalizePendingFilePath, parseBottomSelection, replCompleter } from '../src/cli/repl.js';

describe('REPL command completer', () => {
  it('suggests slash commands by prefix', async () => {
    const [hits] = await replCompleter('/sta');
    expect(hits).toContain('/status ');
  });
  it('suggests config keys', async () => {
    const [hits] = await replCompleter('/config p');
    expect(hits).toContain('/config provider ');
  });
  it('does not complete normal chat messages', async () => {
    const [hits] = await replCompleter('hello');
    expect(hits).toEqual([]);
  });
});

describe('REPL bottom option selection', () => {
  it('parses single and multi-number selections', () => {
    expect(parseBottomSelection('1', 4)).toEqual([0]);
    expect(parseBottomSelection('1和2', 4)).toEqual([0, 1]);
  });
  it('rejects ordinary chat and out-of-range choices', () => {
    expect(parseBottomSelection('1和2可以吗', 4)).toEqual([]);
    expect(parseBottomSelection('5', 4)).toEqual([]);
  });
});

describe('REPL write path normalization', () => {
  it('stores generated markdown documents under docs by default', () => {
    expect(normalizePendingFilePath('README.md')).toBe('docs/README.md');
  });
  it('keeps existing docs paths and non-document paths unchanged', () => {
    expect(normalizePendingFilePath('docs/architecture.md')).toBe('docs/architecture.md');
    expect(normalizePendingFilePath('src/index.ts')).toBe('src/index.ts');
  });
});

describe('REPL write intent detection', () => {
  it('does not treat read-only project analysis as a write task', () => {
    expect(isWriteIntendedInput('分析项目结构和代码质量')).toBe(false);
  });
  it('detects explicit write and repair tasks', () => {
    expect(isWriteIntendedInput('补齐所有缺失文档')).toBe(true);
  });
});
