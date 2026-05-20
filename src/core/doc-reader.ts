// Document Reader — PDF + HTML + PPT/PPTX text extraction
// PDF: uses pdf-parse if available, falls back to heuristic extraction
// HTML: regex-based text extraction
// PPTX: ZIP-based XML slide extraction
// PPT: metadata + basic extraction hints

export interface DocReadResult {
  text: string;
  metadata: {
    title?: string;
    pageCount?: number;  // for PDF: pages, for PPTX: slides
    type: 'pdf' | 'html' | 'pptx' | 'ppt' | 'docx' | 'xlsx';
    source: string;
    length: number;
  };
}

/** Read a PDF file and extract text */
export async function readPdfFile(filePath: string): Promise<DocReadResult> {
  // Try pdf-parse (requires npm install pdf-parse)
  try {
    const fs = await import('fs/promises');
    const buf = await fs.readFile(filePath);
    // pdf-parse v1.x runs a test parse on module load, emitting pdfjs-dist's
    // "Warning: Indexing all PDF objects" DURING require(). Patch both console.warn
    // and process.stderr.write BEFORE the require so the noise is suppressed on
    // first load AND on subsequent parse calls.
    const isPdfNoise = (s: string) => /Indexing all PDF|pdfjs-dist/i.test(s);
    const origWarn = console.warn.bind(console);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origStderrWrite = (process.stderr as any).write.bind(process.stderr);
    console.warn = (...args: unknown[]) => {
      if (!isPdfNoise(args.map(a => String(a)).join(' '))) origWarn(...args);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = (chunk: unknown, ...rest: unknown[]): boolean => {
      const s = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      if (isPdfNoise(s)) return true;
      return origStderrWrite(chunk, ...rest) as boolean;
    };
    let pdfParse: (buf: Buffer, opts?: Record<string, unknown>) => Promise<{ text: string; numpages: number; info?: { Title?: string } }>;
    let data: { text: string; numpages: number; info?: { Title?: string } };
    try {
      pdfParse = require('pdf-parse');
      data = await pdfParse(buf, { verbosityLevel: 0 });
    } finally {
      console.warn = origWarn;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = origStderrWrite;
    }
    return {
      text: data.text.slice(0, 50000),
      metadata: {
        title: data.info?.Title || undefined,
        pageCount: data.numpages,
        type: 'pdf',
        source: filePath,
        length: data.text.length,
      },
    };
  } catch (e: any) {
    // pdf-parse not available — fall back to basic extraction
    return extractPdfTextFallback(filePath);
  }
}

/** Read an HTML file and extract clean text */
export async function readHtmlFile(filePath: string): Promise<DocReadResult> {
  try {
    const fs = await import('fs/promises');
    const html = await fs.readFile(filePath, 'utf-8');
    const trimmed = html.slice(0, 200000);

    // Extract title
    const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim();

    // Remove scripts, styles, comments
    let cleaned = trimmed;
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    cleaned = cleaned.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    cleaned = cleaned.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

    // Convert to text
    let text = cleaned
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s*\n/gm, '')
      .trim();

    // Limit to 50000 chars
    if (text.length > 50000) {
      text = text.slice(0, 50000) + '\n\n... (内容已截断)';
    }

    return {
      text,
      metadata: { title, type: 'html', source: filePath, length: text.length },
    };
  } catch (e: any) {
    throw new Error(`HTML 读取失败: ${e.message}`);
  }
}

/** PDF fallback — basic text extraction without pdf-parse */
async function extractPdfTextFallback(filePath: string): Promise<DocReadResult> {
  try {
    const fs = await import('fs/promises');
    const buf = await fs.readFile(filePath);

    // Basic PDF header check
    const isPdf = buf.slice(0, 5).toString() === '%PDF-';
    if (!isPdf) throw new Error('不是有效的 PDF 文件');

    // Extract readable text using simple stream parsing
    const content = buf.toString('latin1');
    const textBlocks: string[] = [];

    // Find text between BT (Begin Text) and ET (End Text) markers
    const btRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let match;
    while ((match = btRegex.exec(content)) !== null) {
      // Extract text from Tj, TJ, ' operators
      const block = match[1];
      const tjRegex = /\((?:[^()]|\([^)]*\))*\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        const text = tjMatch[0].replace(/\s*Tj$/, '').slice(1, -1);
        if (text.trim()) textBlocks.push(text);
      }
      // Also try TJ arrays
      const tjArrRegex = /\[([^\]]+)\]\s*TJ/g;
      let tjArrMatch;
      while ((tjArrMatch = tjArrRegex.exec(block)) !== null) {
        const arr = tjArrMatch[1];
        const pieces = arr.match(/\([^)]*\)/g);
        if (pieces) textBlocks.push(pieces.map(p => p.slice(1, -1)).join(''));
      }
    }

    const text = textBlocks.length > 0
      ? textBlocks.join('\n').slice(0, 50000)
      : `PDF 文件 (${(buf.length / 1024).toFixed(1)} KB)。安装 pdf-parse 以获取完整文本提取: npm install pdf-parse`;

    return {
      text,
      metadata: {
        type: 'pdf',
        source: filePath,
        length: text.length,
        pageCount: textBlocks.length > 0 ? undefined : undefined,
      },
    };
  } catch (e: any) {
    throw new Error(`PDF 读取失败: ${e.message}`);
  }
}

/** Read PPTX (modern PowerPoint) — ZIP containing XML slides */
export async function readPptxFile(filePath: string): Promise<DocReadResult> {
  try {
    const fs = await import('fs/promises');
    const buf = await fs.readFile(filePath);

    // PPTX is a ZIP file — find slide XMLs and extract <a:t> text
    const slides = extractPptxSlides(buf);
    if (slides.length > 0) {
      const text = slides.map((s, i) => `## Slide ${i + 1}\n${s}`).join('\n\n');
      return {
        text: text.slice(0, 50000),
        metadata: { pageCount: slides.length, type: 'pptx', source: filePath, length: text.length },
      };
    }

    // Fallback: scan raw bytes for readable text
    const rawText = buf.toString('utf-8').replace(/[^\x20-\x7E一-鿿　-〿＀-￯\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      text: rawText.slice(0, 10000) || `PPTX 文件 (${(buf.length / 1024).toFixed(1)} KB)。`,
      metadata: { type: 'pptx', source: filePath, length: rawText.length },
    };
  } catch (e: any) {
    throw new Error(`PPTX 读取失败: ${e.message}`);
  }
}

/** Read DOCX (modern Word) — ZIP containing word/document.xml */
export async function readDocxFile(filePath: string): Promise<DocReadResult> {
  try {
    const fs = await import('fs/promises');
    const buf = await fs.readFile(filePath);
    const entries = findZipEntries(buf);
    const docEntry = entries.find(e => /word\/document\.xml/i.test(e.name));
    if (!docEntry) throw new Error('未找到 word/document.xml');

    const xml = inflateZipEntry(buf, docEntry);
    // Extract text from <w:t> tags (WordprocessingML text runs)
    const texts: string[] = [];
    const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = tRegex.exec(xml)) !== null) {
      const t = m[1].trim();
      if (t) texts.push(t);
    }

    // Detect paragraphs — <w:p> wraps text runs
    const paragraphs: string[] = [];
    const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
    while ((m = pRegex.exec(xml)) !== null) {
      const runs: string[] = [];
      const tInP = m[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      if (tInP) {
        for (const t of tInP) {
          const content = t.replace(/<[^>]+>/g, '').trim();
          if (content) runs.push(content);
        }
      }
      if (runs.length > 0) paragraphs.push(runs.join(''));
    }

    const text = paragraphs.length > 0
      ? paragraphs.join('\n\n').slice(0, 50000)
      : texts.join('\n').slice(0, 50000);

    return {
      text: text || `DOCX 文件 (${(buf.length / 1024).toFixed(1)} KB)。`,
      metadata: { type: 'docx', source: filePath, length: text.length },
    };
  } catch (e: any) {
    throw new Error(`DOCX 读取失败: ${e.message}`);
  }
}

/** Read XLSX (modern Excel) — ZIP containing xl/worksheets/sheet1.xml */
export async function readXlsxFile(filePath: string): Promise<DocReadResult> {
  try {
    const fs = await import('fs/promises');
    const buf = await fs.readFile(filePath);
    const entries = findZipEntries(buf);

    // Find shared strings (if present)
    let sharedStrings: string[] = [];
    const ssEntry = entries.find(e => /xl\/sharedStrings\.xml/i.test(e.name));
    if (ssEntry) {
      const ssXml = inflateZipEntry(buf, ssEntry);
      const siRegex = /<si>[\s\S]*?<\/si>/g;
      let m;
      while ((m = siRegex.exec(ssXml)) !== null) {
        const t = m[0].match(/<t[^>]*>([^<]*)<\/t>/)?.[1] || '';
        sharedStrings.push(t);
      }
    }

    // Parse sheet data
    const sheetEntries = entries.filter(e => /xl\/worksheets\/sheet\d*\.xml/i.test(e.name));
    const rows: string[][] = [];
    for (const sheet of sheetEntries) {
      try {
        const xml = inflateZipEntry(buf, sheet);
        const rowRegex = /<row[^>]*>[\s\S]*?<\/row>/g;
        let m;
        while ((m = rowRegex.exec(xml)) !== null) {
          const cells: string[] = [];
          const cRegex = /<c[^>]*>[\s\S]*?<\/c>/g;
          let cm;
          while ((cm = cRegex.exec(m[0])) !== null) {
            const t = cm[1].match(/t="(s|inlineStr|str)"/);
            const vMatch = cm[0].match(/<v[^>]*>([^<]*)<\/v>/);
            if (vMatch) {
              const v = vMatch[1];
              if (t && t[1] === 's' && sharedStrings[parseInt(v)]) {
                cells.push(sharedStrings[parseInt(v)]);
              } else {
                cells.push(v);
              }
            } else {
              cells.push('');
            }
          }
          if (cells.some(c => c)) rows.push(cells);
        }
      } catch { /* skip corrupt sheet */ }
    }

    const text = rows.length > 0
      ? rows.map(r => r.join('\t')).join('\n').slice(0, 50000)
      : `XLSX 文件 (${(buf.length / 1024).toFixed(1)} KB)。`;

    return {
      text,
      metadata: { type: 'xlsx', source: filePath, length: text.length },
    };
  } catch (e: any) {
    throw new Error(`XLSX 读取失败: ${e.message}`);
  }
}

/** Read PPT (legacy PowerPoint) — binary format, basic extraction */
export async function readPptFile(filePath: string): Promise<DocReadResult> {
  try {
    const fs = await import('fs/promises');
    const buf = await fs.readFile(filePath);

    // Extract readable ASCII/Unicode text from binary
    const text = extractBinaryText(buf);

    return {
      text: text || `PPT 文件 (${(buf.length / 1024).toFixed(1)} KB)。旧版 .ppt 格式为二进制，文本提取有限。建议转换为 .pptx 格式以获得完整读取。`,
      metadata: { type: 'ppt', source: filePath, length: text.length },
    };
  } catch (e: any) {
    throw new Error(`PPT 读取失败: ${e.message}`);
  }
}

// ── PPTX internals ──

function extractPptxSlides(buf: Buffer): string[] {
  try {
    // Find ZIP central directory entries for slide XMLs
    const entries = findZipEntries(buf);
    const slideEntries = entries.filter(e => /ppt\/slides\/slide\d+\.xml/i.test(e.name));
    slideEntries.sort((a, b) => {
      const an = parseInt((a.name.match(/slide(\d+)/) || ['', '0'])[1]);
      const bn = parseInt((b.name.match(/slide(\d+)/) || ['', '0'])[1]);
      return an - bn;
    });

    const slides: string[] = [];
    for (const entry of slideEntries) {
      try {
        const xml = inflateZipEntry(buf, entry);
        // Extract text from <a:t> tags (DrawingML text)
        const texts: string[] = [];
        const tRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
        let m;
        while ((m = tRegex.exec(xml)) !== null) {
          const t = m[1].trim();
          if (t) texts.push(t);
        }
        if (texts.length > 0) slides.push(texts.join('\n'));
      } catch { /* skip corrupt slide */ }
    }
    return slides;
  } catch { return []; }
}

interface ZipEntry { name: string; offset: number; compressedSize: number; compressionMethod: number; }

function findZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  // Scan for local file headers (PK\x03\x04)
  let pos = 0;
  while (pos < buf.length - 30) {
    const sig = buf.readUInt32LE(pos);
    if (sig === 0x04034b50) {
      const compressionMethod = buf.readUInt16LE(pos + 8);
      const compressedSize = buf.readUInt32LE(pos + 18);
      const nameLen = buf.readUInt16LE(pos + 26);
      const extraLen = buf.readUInt16LE(pos + 28);
      const name = buf.slice(pos + 30, pos + 30 + nameLen).toString('utf-8');
      const dataOffset = pos + 30 + nameLen + extraLen;
      entries.push({ name, offset: dataOffset, compressedSize, compressionMethod });
      pos = dataOffset + compressedSize;
    } else {
      pos++;
    }
  }
  return entries;
}

function inflateZipEntry(buf: Buffer, entry: ZipEntry): string {
  const data = buf.slice(entry.offset, entry.offset + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    // Stored (no compression)
    return data.toString('utf-8');
  }
  // DEFLATE (compression method 8)
  const zlib = require('zlib');
  return zlib.inflateRawSync(data).toString('utf-8');
}

function extractBinaryText(buf: Buffer): string {
  // Extract runs of readable text (ASCII + CJK) from binary
  const chunks: string[] = [];
  let current = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if ((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x0d || b === 0x09 || (b >= 0x80 && b < 0xfd)) {
      current += String.fromCharCode(b);
    } else if (current.length >= 3) {
      const clean = current.replace(/[^\x20-\x7E一-鿿　-〿＀-￯\n\r\t]/g, '').trim();
      if (clean.length >= 3) chunks.push(clean);
      current = '';
    } else {
      current = '';
    }
  }
  return chunks.join('\n').slice(0, 10000);
}

/** Check if a file is a readable document type */
export function isDocumentFile(filePath: string): DocReadResult['metadata']['type'] | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'ppt') return 'ppt';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}

/** Auto-detect and read a document file */
export async function readDocumentFile(filePath: string): Promise<DocReadResult | null> {
  const type = isDocumentFile(filePath);
  if (!type) return null;
  switch (type) {
    case 'pdf': return readPdfFile(filePath);
    case 'html': return readHtmlFile(filePath);
    case 'pptx': return readPptxFile(filePath);
    case 'ppt': return readPptFile(filePath);
    case 'docx': return readDocxFile(filePath);
    case 'xlsx': return readXlsxFile(filePath);
  }
}
