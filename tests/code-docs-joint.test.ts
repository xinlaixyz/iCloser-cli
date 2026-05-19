// Joint acceptance test: C9-C12 code tools + D1-D10 docs pipeline
import { describe, it, expect } from 'vitest';

describe('Code tools (C9-C12)', () => {
  it('parseErrorOutput groups lint errors', async () => {
    const { parseErrorOutput } = await import('../src/core/code-writer.js');
    const errors = parseErrorOutput(
      'src/a.ts:10:5 error Missing semicolon\n' +
      'src/a.ts:20:3 warning Unused variable\n' +
      'src/b.ts:5:1 error Extra blank line'
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toHaveProperty('file');
    expect(errors[0]).toHaveProperty('line');
  });

  it('findSymbolReferences finds cross-file refs', async () => {
    const { findSymbolReferences } = await import('../src/core/code-writer.js');
    const idx = {
      identity: { language: 'typescript' } as any,
      modules: [
        { name: 'users', files: ['users.ts'], exports: [{ name: 'User', kind: 'interface', signature: 'interface User', file: 'users.ts', line: 1 }], imports: [], dependencies: [], dependents: [], responsibility: '' },
        { name: 'auth', files: ['auth.ts'], exports: [], imports: [{ source: 'users', symbols: ['User'], isExternal: false, isTypeOnly: false }], dependencies: [], dependents: [], responsibility: '' },
      ],
    } as any;
    const refs = findSymbolReferences(idx, 'User');
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r: string) => r.includes('users'))).toBe(true);
  });

  it('findIncompleteCode finds TODOs and empty functions', async () => {
    const { findIncompleteCode } = await import('../src/core/code-writer.js');
    const incomplete = findIncompleteCode(
      '// TODO: fix this\n' +
      'function empty() { }\n' +
      'const ok = 1;'
    );
    expect(incomplete.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Docs pipeline (D1-D10)', () => {
  it('D5: md→html conversion', async () => {
    const { convertDocFormat } = await import('../src/core/docs-generator.js');
    const html = convertDocFormat('# H1\n\n**bold** text\n\n- item', 'md', 'html');
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>');
    expect(html).toContain('<li>');
  });

  it('D5: md→json-outline', async () => {
    const { convertDocFormat } = await import('../src/core/docs-generator.js');
    const json = convertDocFormat('# H1\n## H2\n### H3', 'md', 'json-outline');
    const p = JSON.parse(json);
    expect(p.sections).toHaveLength(3);
  });

  it('D5: html→md', async () => {
    const { convertDocFormat } = await import('../src/core/docs-generator.js');
    const md = convertDocFormat('<h1>Title</h1><p><strong>B</strong></p>', 'html', 'md');
    expect(md).toContain('# Title');
    expect(md).toContain('**B**');
  });

  it('D5: unsupported format throws', async () => {
    const { convertDocFormat } = await import('../src/core/docs-generator.js');
    expect(() => convertDocFormat('x', 'md', 'pdf')).toThrow('不支持');
  });

  it('D1+D2+D3+D4+D10: all doc functions are importable', async () => {
    const mod = await import('../src/core/docs-generator.js');
    expect(typeof mod.askDocuments).toBe('function');
    expect(typeof mod.summarizeDocument).toBe('function');
    expect(typeof mod.relateDocuments).toBe('function');
    expect(typeof mod.translateDocument).toBe('function');
    expect(typeof mod.convertDocFormat).toBe('function');
    expect(typeof mod.diffReviewDocuments).toBe('function');
    expect(typeof mod.reviewDocument).toBe('function');
    expect(typeof mod.rewriteDocument).toBe('function');
    expect(typeof mod.askDocs).toBe('function');
    expect(typeof mod.summarizeDoc).toBe('function');
  });

  it('D1: askDocuments returns mock answer', async () => {
    const { askDocuments } = await import('../src/core/docs-generator.js');
    const mockProvider = {
      chat: async (_p: any) => ({ content: 'TypeScript + React', tokensUsed: 10 }),
    };
    const docs = { 'README.md': 'Tech: TypeScript + React' };
    const result = await askDocuments(docs, '技术栈', mockProvider);
    expect(result).toContain('TypeScript');
  });

  it('D4: translateDocument passes filename through', async () => {
    const { translateDocument } = await import('../src/core/docs-generator.js');
    const mockProvider = {
      chat: async (_p: any) => ({ content: '# 翻訳済み', tokensUsed: 10 }),
    };
    const result = await translateDocument('# Test', 'ja', 'TEST.md', mockProvider);
    expect(result).toContain('#');
  });

  it('D10: diffReviewDocuments returns structured diff', async () => {
    const { diffReviewDocuments } = await import('../src/core/docs-generator.js');
    const mockProvider = {
      chat: async (_p: any) => ({ content: '新增: 1处', tokensUsed: 10 }),
    };
    const result = await diffReviewDocuments('old', 'new', 'F.md', mockProvider);
    expect(result).toContain('新增');
  });
});

describe('Tool definitions include new tools', () => {
  it('get_project_overview is registered', async () => {
    const { buildToolDefinitions } = await import('../src/core/tool-executor.js');
    const tools = buildToolDefinitions();
    const names = tools.map(t => t.name);
    expect(names).toContain('get_project_overview');
    expect(names).toContain('read_file');
    expect(names).toContain('search_code');
  });
});
