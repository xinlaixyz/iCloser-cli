import { describe, expect, it } from 'vitest';
import { isWriteIntendedInput, normalizePendingFilePath, parseBottomSelection, replCompleter } from '../src/cli/repl.js';

describe('REPL command completer', () => {
  it('suggests slash commands by prefix', () => {
    const [hits] = replCompleter('/sta');
    expect(hits).toContain('/status ');
  });

  it('suggests doctor command by prefix', () => {
    const [hits] = replCompleter('/doc');
    expect(hits).toContain('/doctor ');
  });

  it('suggests config keys', () => {
    const [hits] = replCompleter('/config p');
    expect(hits).toContain('/config provider ');
  });

  it('suggests provider names for config provider', () => {
    const [hits] = replCompleter('/config provider de');
    expect(hits).toContain('/config provider deepseek');
  });

  it('suggests provider names for apikey command', () => {
    const [hits] = replCompleter('/apikey de');
    expect(hits).toContain('/apikey deepseek ');
  });

  it('suggests models for the current provider', () => {
    const [hits] = replCompleter('/config model deep');
    expect(hits.some(hit => hit.includes('deepseek'))).toBe(true);
  });

  it('does not complete normal chat messages', () => {
    const [hits] = replCompleter('hello');
    expect(hits).toEqual([]);
  });
});

describe('REPL bottom option selection', () => {
  it('parses single and multi-number selections', () => {
    expect(parseBottomSelection('1', 4)).toEqual([0]);
    expect(parseBottomSelection('1和2', 4)).toEqual([0, 1]);
    expect(parseBottomSelection('1,2', 4)).toEqual([0, 1]);
    expect(parseBottomSelection('1 2', 4)).toEqual([0, 1]);
  });

  it('parses ranges and all aliases', () => {
    expect(parseBottomSelection('1-3', 4)).toEqual([0, 1, 2]);
    expect(parseBottomSelection('全部', 3)).toEqual([0, 1, 2]);
    expect(parseBottomSelection('all', 2)).toEqual([0, 1]);
  });

  it('rejects ordinary chat and out-of-range choices', () => {
    expect(parseBottomSelection('1和2可以吗', 4)).toEqual([]);
    expect(parseBottomSelection('5', 4)).toEqual([]);
    expect(parseBottomSelection('0', 4)).toEqual([]);
  });
});

describe('REPL write path normalization', () => {
  it('stores generated markdown documents under docs by default', () => {
    expect(normalizePendingFilePath('README.md')).toBe('docs/README.md');
    expect(normalizePendingFilePath('architecture.md')).toBe('docs/architecture.md');
    expect(normalizePendingFilePath('doc/architecture.md')).toBe('docs/architecture.md');
  });

  it('keeps existing docs paths and non-document paths unchanged', () => {
    expect(normalizePendingFilePath('docs/architecture.md')).toBe('docs/architecture.md');
    expect(normalizePendingFilePath('src/index.ts')).toBe('src/index.ts');
    expect(normalizePendingFilePath('guide.txt')).toBe('guide.txt');
  });
});
describe('REPL write intent detection', () => {
  it('does not treat read-only project analysis as a write task', () => {
    expect(isWriteIntendedInput('分析项目结构和代码质量')).toBe(false);
    expect(isWriteIntendedInput('当前目录有哪些问题')).toBe(false);
  });

  it('detects explicit write and repair tasks', () => {
    expect(isWriteIntendedInput('补齐所有缺失文档')).toBe(true);
    expect(isWriteIntendedInput('修复写入操作的 bug')).toBe(true);
    expect(isWriteIntendedInput('generate README docs')).toBe(true);
  });
});

