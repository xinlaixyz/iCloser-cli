import { describe, expect, it } from 'vitest';
import { sanitizeOutput, sanitizeWrite, getSanitizerStats } from '../src/cli/output.js';

describe('sanitizeOutput (S20.1)', () => {
  it('passes through normal ASCII text', () => {
    const input = 'Hello world\nLine 2';
    expect(sanitizeOutput(input)).toBe('Hello world\nLine 2');
  });

  it('passes through Chinese text', () => {
    const input = '你好世界\n第二行';
    expect(sanitizeOutput(input)).toBe('你好世界\n第二行');
  });

  it('passes through emoji', () => {
    const input = '✅ Done ❌ Fail';
    expect(sanitizeOutput(input)).toBe('✅ Done ❌ Fail');
  });

  it('passes through ANSI escape codes', () => {
    const input = '\x1b[32mGreen\x1b[0m Text';
    expect(sanitizeOutput(input)).toContain('\x1b[32m');
    expect(sanitizeOutput(input)).toContain('Green');
  });

  it('filters control characters (0-8, 11-12, 14-31)', () => {
    const input = 'Hello\x00World\x01!\x02\nNew\x07Line\x0BHere\x0CTest';
    const out = sanitizeOutput(input);
    expect(out).not.toContain('\x00');
    expect(out).not.toContain('\x01');
    expect(out).not.toContain('\x07');
    expect(out).toContain('HelloWorld');
    expect(out).toContain('\n');
  });

  it('retains \\n, \\r, \\t', () => {
    const input = 'a\tb\nc\rd';
    const out = sanitizeOutput(input);
    expect(out).toContain('\t');
    expect(out).toContain('\n');
    expect(out).toContain('\r');
  });

  it('truncates lines over 1000 characters', () => {
    const long = 'x'.repeat(1200);
    const out = sanitizeOutput(long);
    expect(out.length).toBeLessThanOrEqual(1003);
    expect(out).toContain('…');
  });

  it('truncates long lines in multi-line input', () => {
    const long = 'x'.repeat(1200);
    const input = `short line\n${long}\nshort line`;
    const out = sanitizeOutput(input);
    const lines = out.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe('short line');
    expect(lines[1].length).toBeLessThanOrEqual(1003);
    expect(lines[2]).toBe('short line');
  });

  it('does not modify short lines', () => {
    const input = 'short line\nanother line\nthird line';
    expect(sanitizeOutput(input)).toBe(input);
  });

  it('tracks sanitized character count', () => {
    const before = getSanitizerStats().chars;
    sanitizeOutput('test\x00\x01\x02test');
    const after = getSanitizerStats().chars;
    expect(after).toBeGreaterThan(before);
  });

  it('empty input returns empty', () => {
    expect(sanitizeOutput('')).toBe('');
  });
});
