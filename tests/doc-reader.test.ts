// Unit tests for src/core/doc-reader.ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  isDocumentFile,
  readHtmlFile,
  readDocumentFile,
  readPptFile,
} from '../src/core/doc-reader.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'icloser-docreader-'));
  roots.push(d);
  return d;
}
afterAll(async () => {
  for (const r of roots) try { await rm(r, { recursive: true, force: true }); } catch {}
});

describe('isDocumentFile', () => {
  it('identifies pdf', () => expect(isDocumentFile('report.pdf')).toBe('pdf'));
  it('identifies html', () => expect(isDocumentFile('page.html')).toBe('html'));
  it('identifies htm', () => expect(isDocumentFile('page.htm')).toBe('html'));
  it('identifies pptx', () => expect(isDocumentFile('deck.pptx')).toBe('pptx'));
  it('identifies ppt', () => expect(isDocumentFile('deck.ppt')).toBe('ppt'));
  it('identifies docx', () => expect(isDocumentFile('doc.docx')).toBe('docx'));
  it('identifies xlsx', () => expect(isDocumentFile('data.xlsx')).toBe('xlsx'));
  it('returns null for unknown extension', () => expect(isDocumentFile('image.png')).toBeNull());
  it('returns null for ts file', () => expect(isDocumentFile('src/index.ts')).toBeNull());
  it('is case-insensitive for extension', () => expect(isDocumentFile('REPORT.PDF')).toBe('pdf'));
});

describe('readHtmlFile', () => {
  it('extracts plain text from HTML', async () => {
    const dir = await makeDir();
    const p = join(dir, 'test.html');
    await writeFile(p, '<html><head><title>Test Page</title></head><body><h1>Hello</h1><p>World</p></body></html>', 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('World');
    expect(result.metadata.title).toBe('Test Page');
    expect(result.metadata.type).toBe('html');
    expect(result.metadata.source).toBe(p);
  });

  it('strips script and style tags', async () => {
    const dir = await makeDir();
    const p = join(dir, 'scripted.html');
    await writeFile(p, `<html><head>
      <style>body { color: red; }</style>
    </head><body>
      <script>alert('xss')</script>
      <p>Clean content</p>
    </body></html>`, 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.text).toContain('Clean content');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('color: red');
  });

  it('strips nav and footer', async () => {
    const dir = await makeDir();
    const p = join(dir, 'nav.html');
    await writeFile(p, `<html><body>
      <nav>Navigation menu items</nav>
      <main><p>Main content here</p></main>
      <footer>Footer links</footer>
    </body></html>`, 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.text).toContain('Main content here');
    expect(result.text).not.toContain('Navigation menu items');
    expect(result.text).not.toContain('Footer links');
  });

  it('decodes HTML entities', async () => {
    const dir = await makeDir();
    const p = join(dir, 'entities.html');
    await writeFile(p, '<html><body><p>Price: &lt;100&gt; &amp; free</p></body></html>', 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.text).toContain('<100>');
    expect(result.text).toContain('& free');
  });

  it('handles HTML without title', async () => {
    const dir = await makeDir();
    const p = join(dir, 'notitle.html');
    await writeFile(p, '<html><body><p>No title here</p></body></html>', 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.metadata.title).toBeUndefined();
    expect(result.text).toContain('No title here');
  });

  it('truncates long content to 50000 chars', async () => {
    const dir = await makeDir();
    const p = join(dir, 'long.html');
    const longText = 'x'.repeat(60000);
    await writeFile(p, `<html><body><p>${longText}</p></body></html>`, 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.text.length).toBeLessThanOrEqual(50100);
    expect(result.text).toContain('(内容已截断)');
  });

  it('throws on non-existent file', async () => {
    await expect(readHtmlFile('/nonexistent/missing.html')).rejects.toThrow();
  });
});

describe('readDocumentFile', () => {
  it('returns null for unsupported file type', async () => {
    const result = await readDocumentFile('image.png');
    expect(result).toBeNull();
  });

  it('dispatches HTML file to readHtmlFile', async () => {
    const dir = await makeDir();
    const p = join(dir, 'page.html');
    await writeFile(p, '<html><body><p>Dispatched</p></body></html>', 'utf-8');
    const result = await readDocumentFile(p);
    expect(result).not.toBeNull();
    expect(result!.metadata.type).toBe('html');
    expect(result!.text).toContain('Dispatched');
  });

  it('dispatches htm file to readHtmlFile', async () => {
    const dir = await makeDir();
    const p = join(dir, 'page.htm');
    await writeFile(p, '<html><body><p>HTM page</p></body></html>', 'utf-8');
    const result = await readDocumentFile(p);
    expect(result).not.toBeNull();
    expect(result!.metadata.type).toBe('html');
  });
});

describe('readPptFile', () => {
  it('reads a PPT-like binary and returns metadata', async () => {
    const dir = await makeDir();
    const p = join(dir, 'deck.ppt');
    // Create a fake PPT binary with some readable ASCII text
    const content = Buffer.concat([
      Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), // OLE header
      Buffer.from('Hello World presentation slide content'),
      Buffer.alloc(100, 0),
    ]);
    await writeFile(p, content);
    const result = await readPptFile(p);
    expect(result.metadata.type).toBe('ppt');
    expect(result.metadata.source).toBe(p);
    expect(typeof result.text).toBe('string');
  });
});

describe('HTML parsing edge cases', () => {
  it('handles comments removal', async () => {
    const dir = await makeDir();
    const p = join(dir, 'comments.html');
    await writeFile(p, '<html><body><!-- This is a comment --><p>Visible text</p></body></html>', 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.text).toContain('Visible text');
    expect(result.text).not.toContain('This is a comment');
  });

  it('handles br tags as newlines', async () => {
    const dir = await makeDir();
    const p = join(dir, 'br.html');
    await writeFile(p, '<html><body><p>Line one<br>Line two<br/>Line three</p></body></html>', 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.text).toContain('Line one');
    expect(result.text).toContain('Line two');
    expect(result.text).toContain('Line three');
  });

  it('handles &nbsp; as space', async () => {
    const dir = await makeDir();
    const p = join(dir, 'nbsp.html');
    await writeFile(p, '<html><body><p>word&nbsp;space</p></body></html>', 'utf-8');
    const result = await readHtmlFile(p);
    expect(result.text).toContain('word space');
  });
});
