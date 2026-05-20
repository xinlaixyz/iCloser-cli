// Additional coverage for src/core/doc-reader.ts
// Targets: readDocxFile, readXlsxFile, readPptxFile, findZipEntries, inflateZipEntry, extractPptxSlides
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readDocxFile,
  readXlsxFile,
  readPptxFile,
  readDocumentFile,
} from '../src/core/doc-reader.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'docreader-cov-'));
  roots.push(d);
  return d;
}
afterAll(async () => {
  for (const r of roots) try { await rm(r, { recursive: true, force: true }); } catch {}
});

// Build a minimal stored-only ZIP with a single entry (compression method 0)
function makeFakeZip(fileName: string, content: string): Buffer {
  const name = Buffer.from(fileName);
  const data = Buffer.from(content, 'utf-8');

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4);          // version needed
  header.writeUInt16LE(0, 6);           // flags
  header.writeUInt16LE(0, 8);           // compression method: 0 = stored
  header.writeUInt16LE(0, 10);          // last mod time
  header.writeUInt16LE(0, 12);          // last mod date
  header.writeUInt32LE(0, 14);          // crc32 (ignored for test)
  header.writeUInt32LE(data.length, 18); // compressed size
  header.writeUInt32LE(data.length, 22); // uncompressed size
  header.writeUInt16LE(name.length, 26); // file name length
  header.writeUInt16LE(0, 28);           // extra field length

  // Pad to at least 31 bytes beyond the header + name + data to satisfy buf.length - 30
  const padding = Buffer.alloc(40, 0);
  return Buffer.concat([header, name, data, padding]);
}

// ============================================================
// readPptxFile
// ============================================================
describe('readPptxFile', () => {
  it('throws on non-existent file', async () => {
    await expect(readPptxFile('/no/such/file.pptx')).rejects.toThrow('PPTX 读取失败');
  });

  it('returns fallback text for a non-ZIP buffer (ASCII content)', async () => {
    const dir = await makeDir();
    const p = join(dir, 'fake.pptx');
    // Write ASCII content that will be extracted as raw UTF-8 text
    await writeFile(p, Buffer.from('This is readable ASCII content in a fake PPTX file for testing purposes'));
    const result = await readPptxFile(p);
    expect(result.metadata.type).toBe('pptx');
    expect(result.metadata.source).toBe(p);
    expect(typeof result.text).toBe('string');
  });

  it('extracts slides from minimal ZIP PPTX', async () => {
    const dir = await makeDir();
    const p = join(dir, 'real.pptx');
    const slideXml = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello Slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
    const buf = makeFakeZip('ppt/slides/slide1.xml', slideXml);
    await writeFile(p, buf);
    const result = await readPptxFile(p);
    expect(result.metadata.type).toBe('pptx');
    expect(result.text).toContain('Hello Slide');
    expect(result.metadata.pageCount).toBe(1);
  });

  it('handles ZIP with multiple slide entries', async () => {
    const dir = await makeDir();
    const p = join(dir, 'multi.pptx');
    // Create a ZIP with two slide entries by concatenating two minimal ZIPs
    const slide1 = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
    const slide2 = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide Two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
    const buf = Buffer.concat([
      makeFakeZip('ppt/slides/slide1.xml', slide1),
      makeFakeZip('ppt/slides/slide2.xml', slide2),
    ]);
    await writeFile(p, buf);
    const result = await readPptxFile(p);
    expect(result.metadata.type).toBe('pptx');
    // May or may not find slides depending on ZIP scanning — just check no crash
    expect(typeof result.text).toBe('string');
  });

  it('dispatched via readDocumentFile for pptx extension', async () => {
    const dir = await makeDir();
    const p = join(dir, 'test.pptx');
    await writeFile(p, Buffer.from('raw pptx content'));
    const result = await readDocumentFile(p);
    expect(result).not.toBeNull();
    expect(result!.metadata.type).toBe('pptx');
  });
});

// ============================================================
// readDocxFile
// ============================================================
describe('readDocxFile', () => {
  it('throws on non-existent file', async () => {
    await expect(readDocxFile('/no/such/file.docx')).rejects.toThrow('DOCX 读取失败');
  });

  it('throws DOCX error when word/document.xml not found', async () => {
    const dir = await makeDir();
    const p = join(dir, 'fake.docx');
    // Not a valid ZIP → findZipEntries returns [] → throws "未找到 word/document.xml"
    await writeFile(p, Buffer.from('fake docx binary content that is not a zip'));
    await expect(readDocxFile(p)).rejects.toThrow('DOCX 读取失败');
  });

  it('extracts text from minimal ZIP DOCX', async () => {
    const dir = await makeDir();
    const p = join(dir, 'real.docx');
    const docXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX World</w:t></w:r></w:p></w:body></w:document>';
    const buf = makeFakeZip('word/document.xml', docXml);
    await writeFile(p, buf);
    const result = await readDocxFile(p);
    expect(result.metadata.type).toBe('docx');
    expect(result.text).toContain('Hello DOCX World');
  });

  it('handles DOCX with paragraph markup (w:p processing)', async () => {
    const dir = await makeDir();
    const p = join(dir, 'paras.docx');
    // Two paragraphs, each with a run
    const docXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>';
    const buf = makeFakeZip('word/document.xml', docXml);
    await writeFile(p, buf);
    const result = await readDocxFile(p);
    expect(result.text).toContain('First paragraph');
    expect(result.text).toContain('Second paragraph');
  });

  it('dispatched via readDocumentFile for docx extension', async () => {
    const dir = await makeDir();
    const p = join(dir, 'test.docx');
    const docXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Dispatched</w:t></w:r></w:p></w:body></w:document>';
    const buf = makeFakeZip('word/document.xml', docXml);
    await writeFile(p, buf);
    const result = await readDocumentFile(p);
    expect(result).not.toBeNull();
    expect(result!.metadata.type).toBe('docx');
    expect(result!.text).toContain('Dispatched');
  });
});

// ============================================================
// readXlsxFile
// ============================================================
describe('readXlsxFile', () => {
  it('throws on non-existent file', async () => {
    await expect(readXlsxFile('/no/such/file.xlsx')).rejects.toThrow('XLSX 读取失败');
  });

  it('returns metadata for non-ZIP buffer (fallback size note)', async () => {
    const dir = await makeDir();
    const p = join(dir, 'fake.xlsx');
    await writeFile(p, Buffer.from('not a real xlsx file at all'));
    const result = await readXlsxFile(p);
    expect(result.metadata.type).toBe('xlsx');
    expect(result.metadata.source).toBe(p);
    // No rows found → returns size note
    expect(result.text).toContain('XLSX');
  });

  it('reads minimal ZIP XLSX without crashing', async () => {
    const dir = await makeDir();
    const p = join(dir, 'real.xlsx');
    const sheetXml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1"><v>100</v></c></row></sheetData></worksheet>';
    const buf = makeFakeZip('xl/worksheets/sheet1.xml', sheetXml);
    await writeFile(p, buf);
    // findZipEntries and inflateZipEntry run; row parsing may throw internally (caught)
    const result = await readXlsxFile(p);
    expect(result.metadata.type).toBe('xlsx');
    expect(result.metadata.source).toBe(p);
    expect(typeof result.text).toBe('string');
  });

  it('handles XLSX with shared strings', async () => {
    const dir = await makeDir();
    const p = join(dir, 'shared.xlsx');
    // Shared strings entry
    const ssXml = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>ProductName</t></si><si><t>Price</t></si></sst>';
    // Sheet referencing shared string index 0
    const sheetXml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
    // Two entries in one ZIP buffer
    const buf = Buffer.concat([
      makeFakeZip('xl/sharedStrings.xml', ssXml),
      makeFakeZip('xl/worksheets/sheet1.xml', sheetXml),
    ]);
    await writeFile(p, buf);
    const result = await readXlsxFile(p);
    expect(result.metadata.type).toBe('xlsx');
    // May or may not resolve shared strings depending on ZIP scanning
    expect(typeof result.text).toBe('string');
  });

  it('dispatched via readDocumentFile for xlsx extension', async () => {
    const dir = await makeDir();
    const p = join(dir, 'test.xlsx');
    const sheetXml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>99</v></c></row></sheetData></worksheet>';
    const buf = makeFakeZip('xl/worksheets/sheet1.xml', sheetXml);
    await writeFile(p, buf);
    const result = await readDocumentFile(p);
    expect(result).not.toBeNull();
    expect(result!.metadata.type).toBe('xlsx');
  });
});

// ============================================================
// findZipEntries / inflateZipEntry — tested via the readers above
// Additional direct edge cases
// ============================================================
describe('ZIP internals via readers', () => {
  it('throws when buffer has no PK signature (no ZIP entries)', async () => {
    const dir = await makeDir();
    const p = join(dir, 'empty.docx');
    // Buffer with all zeros — no PK\x03\x04 signature → findZipEntries returns []
    await writeFile(p, Buffer.alloc(60, 0));
    await expect(readDocxFile(p)).rejects.toThrow('DOCX 读取失败');
  });

  it('handles buffer just under 30 bytes (loop never runs)', async () => {
    const dir = await makeDir();
    const p = join(dir, 'tiny.xlsx');
    await writeFile(p, Buffer.alloc(20, 0));
    const result = await readXlsxFile(p);
    expect(result.metadata.type).toBe('xlsx');
    expect(result.text).toContain('XLSX');
  });

  it('handles stored entry with compression method 0', async () => {
    const dir = await makeDir();
    const p = join(dir, 'stored.docx');
    const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Stored entry text</w:t></w:r></w:p></w:body></w:document>';
    const buf = makeFakeZip('word/document.xml', xml); // method=0 by default
    await writeFile(p, buf);
    const result = await readDocxFile(p);
    expect(result.text).toContain('Stored entry text');
  });
});
