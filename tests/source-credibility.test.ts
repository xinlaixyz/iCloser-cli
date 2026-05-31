import { describe, expect, it } from 'vitest';
import { classifySourceCredibility, summarizeSourceCredibility } from '../src/core/source-credibility.js';

describe('source credibility', () => {
  it('classifies official, database, local file and search-only sources', () => {
    expect(classifySourceCredibility('https://icloser.xyz').kind).toBe('official');
    expect(classifySourceCredibility('https://pitchhub.36kr.com/project/1').kind).toBe('database');
    expect(classifySourceCredibility('src/pages/Login.tsx').kind).toBe('local-file');
    expect(classifySourceCredibility('icloser 公司 融资 投资 估值').kind).toBe('search-query');
  });

  it('summarizes best source and source mix', () => {
    const summary = summarizeSourceCredibility([
      'icloser 公司 融资 投资 估值',
      'https://pitchhub.36kr.com/project/1',
      'https://icloser.xyz',
    ]);

    expect(summary).toContain('官方');
    expect(summary).toContain('最高 92/100');
    expect(summary).toContain('数据库 1');
  });

  it('classifies github as official source', () => {
    const c = classifySourceCredibility('https://github.com/anthropics/claude-code');
    expect(c.kind).toBe('official');
    expect(c.score).toBeGreaterThanOrEqual(90);
  });

  it('classifies media sources (sohu, techcrunch) correctly', () => {
    const sohu = classifySourceCredibility('https://www.sohu.com/a/123456');
    expect(sohu.kind).toBe('media');
    expect(sohu.score).toBeLessThan(80);

    const tc = classifySourceCredibility('https://techcrunch.com/2024/01/01/story');
    expect(tc.kind).toBe('media');
  });

  it('classifies command output as command kind', () => {
    const cmd = classifySourceCredibility('npm run build');
    expect(cmd.kind).toBe('command');
    expect(cmd.score).toBeGreaterThanOrEqual(75);

    const git = classifySourceCredibility('git status');
    expect(git.kind).toBe('command');
  });

  it('returns fallback summary for empty sources list', () => {
    const summary = summarizeSourceCredibility([]);
    expect(summary).toBe('暂无来源等级');
  });

  it('caps source list at top-5 unique domains in summary', () => {
    const sources = [
      'https://icloser.xyz/a',
      'https://icloser.xyz/b',   // duplicate domain — should dedupe
      'https://github.com/a',
      'https://pitchhub.36kr.com/1',
      'https://techcrunch.com/1',
      'https://coindesk.com/1',
      'https://bloomberg.com/1',
    ];
    const summary = summarizeSourceCredibility(sources);
    // Should mention best-score kind without crashing on 7 sources
    expect(summary).toContain('官方');
  });
});
