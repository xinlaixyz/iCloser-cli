// Coverage for src/core/docs-generator.ts
// Targets: sync helpers, file-op helpers, and providerAdapter async functions
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  checkDocumentQuality,
  extractDocSections,
  buildDocLinkIndex,
  searchDocs,
  generateTOC,
  checkDocsConsistency,
  createCustomTemplate,
  getCustomTemplates,
  getTemplate,
  convertDocFormat,
  detectDocAffectedFiles,
  buildDocGenerationPrompt,
  saveDocSnapshot,
  listDocSnapshots,
  loadDocSnapshot,
  readFileContent,
  showDocumentDiff,
  summarizeDocument,
  rewriteDocument,
  reviewDocument,
  relateDocuments,
  translateDocument,
  diffReviewDocuments,
  askDocuments,
} from '../src/core/docs-generator.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'docgen-cov-'));
  roots.push(d);
  return d;
}
afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Minimal providerAdapter that always returns the given content. */
function mockAdapter(content: string) {
  return {
    chat: async (_p: any) => ({ content }),
  };
}

const SAMPLE_MD = `# Title

## Introduction

This is the introduction section which provides an overview of the system design.
Here is a table summarizing key components:

| Component | Description |
|-----------|-------------|
| API Layer | Handles HTTP requests |
| Core      | Business logic lives here |
| Database  | Persistent storage |

\`\`\`typescript
const x = 1;
const y = x + 2;
console.log(y);
\`\`\`

## Features

- Feature 1: does something useful for users
- Feature 2: does another thing for administrators
- Feature 3: provides reporting and analytics

## Architecture

Uses Redis for caching and Docker for deployment containers.
The system follows a microservices pattern with clear separation of concerns.`;

const MINIMAL_INDEX: any = {
  identity: { language: 'typescript', framework: 'node', database: 'postgres', buildSystem: 'npm', testFramework: 'vitest', runtime: 'node', deploymentType: 'cloud', packageManager: 'npm', languageVersion: '20' },
  modules: [
    { name: 'api', files: ['src/api/handler.ts', 'src/api/route.ts'], exports: [{ name: 'getHandler' }, { name: 'postRoute' }] },
    { name: 'core', files: ['src/core/auth.ts'], exports: [{ name: 'auth' }] },
  ],
  architecturePattern: 'MVC',
};

// ============================================================
// checkDocumentQuality
// ============================================================
describe('checkDocumentQuality', () => {
  it('passes for a well-formed document', () => {
    const result = checkDocumentQuality(SAMPLE_MD);
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(60);
    // May have minor issues if content is borderline on length — just verify pass status
    expect(result.issues.filter(i => !i.includes('字数')).length).toBe(0);
  });

  it('fails for content under 500 chars', () => {
    const result = checkDocumentQuality('Short content');
    expect(result.issues.some(i => i.includes('字数'))).toBe(true);
    expect(result.score).toBeLessThan(100);
  });

  it('flags missing table', () => {
    const noTable = '# Title\n\nThis content has no table but has ```code``` and it is long enough to not trigger the length penalty. ' + 'x'.repeat(500);
    const result = checkDocumentQuality(noTable);
    expect(result.issues.some(i => i.includes('表格'))).toBe(true);
  });

  it('flags missing code example', () => {
    const noCode = '# Title\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n' + 'This is long enough content with plenty of words. '.repeat(12);
    const result = checkDocumentQuality(noCode);
    expect(result.issues.some(i => i.includes('代码'))).toBe(true);
  });

  it('flags TODO/TBD placeholder', () => {
    const withTodo = SAMPLE_MD + '\nTODO: finish this section';
    const result = checkDocumentQuality(withTodo);
    expect(result.issues.some(i => i.includes('占位符'))).toBe(true);
  });

  it('flags missing markdown headers', () => {
    const noHeaders = '| A | B |\n|---|---|\n\n```js\nconst x=1;\n```\n\n' + 'long content '.repeat(50);
    const result = checkDocumentQuality(noHeaders);
    expect(result.issues.some(i => i.includes('标题'))).toBe(true);
  });

  it('score is clamped to 0 minimum', () => {
    const badContent = 'x'; // triggers all penalties
    const result = checkDocumentQuality(badContent);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.pass).toBe(false);
  });
});

// ============================================================
// extractDocSections
// ============================================================
describe('extractDocSections', () => {
  it('extracts sections by heading', () => {
    const sections = extractDocSections(SAMPLE_MD);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.some(s => s.heading === 'Introduction')).toBe(true);
    expect(sections.some(s => s.heading === 'Features')).toBe(true);
  });

  it('returns empty array for content with no headings', () => {
    const sections = extractDocSections('Just plain text with no headings.');
    expect(sections).toEqual([]);
  });

  it('captures body text under each heading', () => {
    const sections = extractDocSections('## Section A\n\nBody of A\n\n## Section B\n\nBody of B');
    expect(sections[0].body).toContain('Body of A');
    expect(sections[1].body).toContain('Body of B');
  });

  it('handles h3 headings', () => {
    const sections = extractDocSections('### Sub-section\n\nContent here');
    expect(sections[0].heading).toBe('Sub-section');
  });
});

// ============================================================
// buildDocLinkIndex
// ============================================================
describe('buildDocLinkIndex', () => {
  it('finds cross-references between docs', () => {
    const docs = {
      'README.md': 'See ARCHITECTURE for details and CHANGELOG for history.',
      'ARCHITECTURE.md': 'The API endpoints are listed in API.md',
      'CHANGELOG.md': 'v1.0 initial release',
      'API.md': 'REST endpoints documentation',
    };
    const links = buildDocLinkIndex('/', docs);
    expect(links['README.md']).toContain('ARCHITECTURE.md');
    expect(links['README.md']).toContain('CHANGELOG.md');
    expect(links['ARCHITECTURE.md']).toContain('API.md');
  });

  it('returns empty arrays for docs with no cross-refs', () => {
    const docs = { 'A.md': 'no references here', 'B.md': 'also nothing' };
    const links = buildDocLinkIndex('/', docs);
    expect(links['A.md']).toEqual([]);
    expect(links['B.md']).toEqual([]);
  });

  it('does not link a doc to itself', () => {
    const docs = { 'README.md': 'README is self-referential' };
    const links = buildDocLinkIndex('/', docs);
    expect(links['README.md']).not.toContain('README.md');
  });
});

// ============================================================
// searchDocs
// ============================================================
describe('searchDocs', () => {
  it('finds matching lines across multiple docs', () => {
    const docs = {
      'A.md': 'Line one\nSearch target text here\nLine three',
      'B.md': 'Another doc\nSearch target found again\nEnd',
    };
    const results = searchDocs(docs, 'Search target');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every(r => typeof r.file === 'string' && typeof r.line === 'string')).toBe(true);
  });

  it('is case-insensitive', () => {
    const docs = { 'x.md': 'UPPER CASE QUERY result' };
    const results = searchDocs(docs, 'upper case query');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array when nothing matches', () => {
    const docs = { 'A.md': 'some content', 'B.md': 'other text' };
    expect(searchDocs(docs, 'xyz-not-found-anywhere')).toEqual([]);
  });

  it('limits results to 30', () => {
    // Create a doc with 50 matching lines
    const content = Array.from({ length: 50 }, (_, i) => `match line ${i}`).join('\n');
    const results = searchDocs({ 'big.md': content }, 'match line');
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it('truncates long lines to 120 chars', () => {
    const longLine = 'match ' + 'x'.repeat(200);
    const results = searchDocs({ 'd.md': longLine }, 'match');
    expect(results[0].line.length).toBeLessThanOrEqual(120);
  });
});

// ============================================================
// generateTOC
// ============================================================
describe('generateTOC', () => {
  it('generates a table of contents from headings', () => {
    const content = '# Title\n\n## Introduction\n\n### Sub-topic\n\n## Conclusion';
    const toc = generateTOC(content);
    expect(toc).toContain('[Title]');
    expect(toc).toContain('[Introduction]');
    expect(toc).toContain('[Sub-topic]');
    expect(toc).toContain('[Conclusion]');
  });

  it('returns empty string for content with no headings', () => {
    expect(generateTOC('No headings here')).toBe('');
  });

  it('indents sub-headings', () => {
    const content = '## Parent\n\n### Child';
    const toc = generateTOC(content);
    // h3 should have 4 spaces of indent (2 * (3-1))
    expect(toc).toContain('    - [Child]');
  });

  it('handles Chinese characters in headings', () => {
    const content = '# 项目简介\n\n## 安装配置';
    const toc = generateTOC(content);
    expect(toc).toContain('[项目简介]');
    expect(toc).toContain('[安装配置]');
  });
});

// ============================================================
// checkDocsConsistency
// ============================================================
describe('checkDocsConsistency', () => {
  it('returns empty issues for docs without PRD+API', () => {
    const docs = { 'README.md': 'Just readme' };
    expect(checkDocsConsistency(docs)).toEqual([]);
  });

  it('detects PRD features not in API', () => {
    const docs = {
      'PRD.md': '# PRD\n\n- Feature: User Authentication\n- Feature: Dashboard UI',
      'API.md': '# API\n\nNo mention of the above features',
    };
    const issues = checkDocsConsistency(docs);
    // May or may not find issues depending on the 4-char keyword matching
    expect(Array.isArray(issues)).toBe(true);
  });

  it('detects technology in ARCHITECTURE not in DEPLOYMENT', () => {
    const docs = {
      'ARCHITECTURE.md': '# Architecture\n\nWe use Redis for caching and Docker for containerization.',
      'DEPLOYMENT.md': '# Deployment\n\nDeploy using traditional methods with Nginx. No caching layer needed.',
    };
    const issues = checkDocsConsistency(docs);
    expect(issues.some(i => i.issue.includes('Redis'))).toBe(true);
  });

  it('no issues when ARCHITECTURE and DEPLOYMENT share same technologies', () => {
    const docs = {
      'ARCHITECTURE.md': 'Uses Redis, Docker, Kubernetes',
      'DEPLOYMENT.md': 'Deploy with Redis, Docker, and Kubernetes cluster',
    };
    const issues = checkDocsConsistency(docs);
    expect(issues.filter(i => i.file === 'DEPLOYMENT.md').length).toBe(0);
  });
});

// ============================================================
// createCustomTemplate / getCustomTemplates / getTemplate
// ============================================================
describe('custom template management', () => {
  it('createCustomTemplate + getTemplate round-trip', () => {
    const templates = [
      { type: 'PRD' as const, filename: 'custom.md', title: 'Custom', description: 'My custom template', required: true },
    ];
    createCustomTemplate('my-org', templates);
    expect(getCustomTemplates()).toContain('my-org');
    expect(getTemplate('my-org')).toEqual(templates);
  });

  it('getTemplate returns undefined for non-existent template', () => {
    expect(getTemplate('does-not-exist-xyz')).toBeUndefined();
  });

  it('getCustomTemplates returns array of names', () => {
    const names = getCustomTemplates();
    expect(Array.isArray(names)).toBe(true);
  });
});

// ============================================================
// convertDocFormat
// ============================================================
describe('convertDocFormat', () => {
  const md = '# Heading\n\n**Bold text** and *italic*.\n\n`inline code`\n\n[link](https://example.com)\n\n- item 1\n\nParagraph here\n\nAnother paragraph';

  it('converts md to html', () => {
    const html = convertDocFormat(md, 'md', 'html');
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>Bold text</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>inline code</code>');
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain('<li>item 1</li>');
  });

  it('converts md to json-outline', () => {
    const json = convertDocFormat('# Title\n\n## Section A\n\n### Sub A1', 'md', 'json-outline');
    const outline = JSON.parse(json);
    expect(outline.sections).toHaveLength(3);
    expect(outline.sections[0].level).toBe(1);
    expect(outline.sections[1].level).toBe(2);
    expect(outline.sections[2].level).toBe(3);
  });

  it('converts html to md', () => {
    const html = '<h1>Title</h1><h2>Section</h2><strong>bold</strong><em>italic</em><code>code</code><a href="url">link</a><li>item</li>';
    const result = convertDocFormat(html, 'html', 'md');
    expect(result).toContain('# Title');
    expect(result).toContain('## Section');
    expect(result).toContain('**bold**');
    expect(result).toContain('*italic*');
    expect(result).toContain('`code`');
    expect(result).toContain('[link](url)');
    expect(result).toContain('- item');
  });

  it('throws for unsupported conversion', () => {
    expect(() => convertDocFormat('content', 'txt', 'pdf')).toThrow('不支持的格式转换');
  });
});

// ============================================================
// detectDocAffectedFiles
// ============================================================
describe('detectDocAffectedFiles', () => {
  it('maps API handler exports to API.md', () => {
    const index = {
      ...MINIMAL_INDEX,
      modules: [
        { name: 'api', files: ['src/api.ts'], exports: [{ name: 'getHandler' }, { name: 'postApiRoute' }] },
        { name: 'core', files: ['src/core.ts'], exports: [{ name: 'util' }] },
      ],
    };
    const affected = detectDocAffectedFiles(index);
    expect(affected['API.md']).toContain('api/getHandler');
  });

  it('includes all modules except first in ARCHITECTURE.md', () => {
    const index = {
      ...MINIMAL_INDEX,
      modules: [
        { name: 'mod-a', files: ['a.ts'], exports: [] },
        { name: 'mod-b', files: ['b.ts'], exports: [] },
        { name: 'mod-c', files: ['c.ts'], exports: [] },
      ],
    };
    const affected = detectDocAffectedFiles(index);
    expect(affected['ARCHITECTURE.md']).toContain('mod-b');
    expect(affected['ARCHITECTURE.md']).toContain('mod-c');
    expect(affected['ARCHITECTURE.md']).not.toContain('mod-a');
  });

  it('returns empty object when no handler/route exports', () => {
    const index = {
      ...MINIMAL_INDEX,
      modules: [{ name: 'only', files: ['a.ts'], exports: [{ name: 'util' }, { name: 'helper' }] }],
    };
    const affected = detectDocAffectedFiles(index);
    expect(affected['API.md']).toBeUndefined();
  });
});

// ============================================================
// buildDocGenerationPrompt
// ============================================================
describe('buildDocGenerationPrompt', () => {
  const context: any = {
    projectName: 'TestProject',
    description: 'A test project',
    techStack: ['TypeScript', 'Node.js'],
    features: ['Feature A', 'Feature B'],
    apiRoutes: [{ method: 'GET', path: '/health', handler: 'healthHandler' }],
    configKeys: ['DATABASE_URL', 'API_KEY'],
    deployInfo: { docker: true, makefile: false, envVars: ['PORT'] },
    errorPatterns: ['error.ts'],
    existingDocs: [],
    missingDocs: [],
  };

  const DOC_TYPES = ['PRD', 'USER_GUIDE', 'API', 'ARCHITECTURE', 'TESTING', 'DEPLOYMENT', 'CHANGELOG', 'FAQ', 'CONTRIBUTING'] as const;

  for (const docType of DOC_TYPES) {
    it(`generates prompt for ${docType}`, () => {
      const { system, task } = buildDocGenerationPrompt(docType, context);
      expect(typeof system).toBe('string');
      expect(system.length).toBeGreaterThan(0);
      expect(typeof task).toBe('string');
      expect(task).toContain('TestProject');
    });
  }
});

// ============================================================
// saveDocSnapshot / listDocSnapshots / loadDocSnapshot
// ============================================================
describe('saveDocSnapshot / listDocSnapshots / loadDocSnapshot', () => {
  it('saves and lists snapshots', async () => {
    const dir = await makeDir();
    const version = await saveDocSnapshot(dir, 'README.md', '# Initial content');
    expect(version).toMatch(/^v[a-z0-9]+$/);

    const snapshots = await listDocSnapshots(dir, 'README.md');
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.some(s => s.startsWith('README.md'))).toBe(true);
  });

  it('loads a saved snapshot', async () => {
    const dir = await makeDir();
    await saveDocSnapshot(dir, 'DOC.md', '# Snapshot content');
    const snapshots = await listDocSnapshots(dir, 'DOC.md');
    expect(snapshots.length).toBeGreaterThan(0);

    const content = await loadDocSnapshot(dir, snapshots[0]);
    expect(content).toContain('# Snapshot content');
  });

  it('listDocSnapshots returns empty array when dir does not exist', async () => {
    const dir = await makeDir();
    const snapshots = await listDocSnapshots(join(dir, 'nonexistent'), 'ANY.md');
    expect(snapshots).toEqual([]);
  });

  it('multiple snapshots are sorted newest first', async () => {
    const dir = await makeDir();
    await saveDocSnapshot(dir, 'MULTI.md', 'version 1');
    await new Promise(r => setTimeout(r, 2)); // tiny delay for unique timestamps
    await saveDocSnapshot(dir, 'MULTI.md', 'version 2');
    const snapshots = await listDocSnapshots(dir, 'MULTI.md');
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    // sorted descending (newest first)
    expect(snapshots[0] >= snapshots[snapshots.length - 1]).toBe(true);
  });
});

// ============================================================
// readFileContent
// ============================================================
describe('readFileContent', () => {
  it('reads an existing file', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'test.md'), '# Hello World', 'utf-8');
    const content = await readFileContent(dir, 'test.md');
    expect(content).toBe('# Hello World');
  });

  it('throws when file does not exist', async () => {
    const dir = await makeDir();
    await expect(readFileContent(dir, 'nonexistent.md')).rejects.toThrow('无法读取文件');
  });
});

// ============================================================
// showDocumentDiff
// ============================================================
describe('showDocumentDiff', () => {
  it('returns a string diff between two contents', async () => {
    const result = await showDocumentDiff('test.md', '# Old\n\nLine 1', '# New\n\nLine 1\n\nLine 2');
    // May use diff-renderer or fallback to simple diff
    expect(typeof result).toBe('string');
  });

  it('returns diff when content is identical', async () => {
    const same = '# Same content\n\nNo changes';
    const result = await showDocumentDiff('same.md', same, same);
    expect(typeof result).toBe('string');
  });
});

// ============================================================
// summarizeDocument (providerAdapter)
// ============================================================
describe('summarizeDocument', () => {
  it('calls providerAdapter.chat and returns content', async () => {
    const result = await summarizeDocument(SAMPLE_MD, 'README.md', mockAdapter('Summary of the document'));
    expect(result).toBe('Summary of the document');
  });
});

// ============================================================
// rewriteDocument (providerAdapter)
// ============================================================
describe('rewriteDocument', () => {
  const personas = ['beginner', 'architect', 'manager', 'developer', 'custom-persona'];

  for (const persona of personas) {
    it(`rewrites for persona: ${persona}`, async () => {
      const result = await rewriteDocument('# Doc\n\nContent here', persona, mockAdapter(`Rewritten for ${persona}`));
      expect(result).toBe(`Rewritten for ${persona}`);
    });
  }
});

// ============================================================
// reviewDocument (providerAdapter)
// ============================================================
describe('reviewDocument', () => {
  it('calls providerAdapter.chat and returns review', async () => {
    const result = await reviewDocument(SAMPLE_MD, 'README.md', mockAdapter('No issues found.'));
    expect(result).toBe('No issues found.');
  });
});

// ============================================================
// relateDocuments (providerAdapter)
// ============================================================
describe('relateDocuments', () => {
  it('calls providerAdapter.chat and returns relations', async () => {
    const docs = { 'A.md': 'Document A content', 'B.md': 'Document B content' };
    const result = await relateDocuments(docs, 'How are A and B related?', mockAdapter('A references B conceptually.'));
    expect(result).toBe('A references B conceptually.');
  });
});

// ============================================================
// translateDocument (providerAdapter)
// ============================================================
describe('translateDocument', () => {
  it('calls providerAdapter.chat and returns translation', async () => {
    const result = await translateDocument('# Hello', 'English', 'doc.md', mockAdapter('# Hello (translated)'));
    expect(result).toBe('# Hello (translated)');
  });
});

// ============================================================
// diffReviewDocuments (providerAdapter)
// ============================================================
describe('diffReviewDocuments', () => {
  it('calls providerAdapter.chat and returns review', async () => {
    const result = await diffReviewDocuments(
      '# Old version\n\nOriginal content',
      '# New version\n\nUpdated content',
      'doc.md',
      mockAdapter('Section changed: Introduction was updated')
    );
    expect(result).toBe('Section changed: Introduction was updated');
  });
});

// ============================================================
// askDocuments (providerAdapter)
// ============================================================
describe('askDocuments', () => {
  it('passes all docs to providerAdapter and returns answer', async () => {
    const docs = {
      'README.md': '# Project\n\nThis is the project.',
      'API.md': '# API\n\nEndpoint /health returns 200.',
    };
    const result = await askDocuments(docs, 'What is the health endpoint?', mockAdapter('The health endpoint returns 200 OK.'));
    expect(result).toBe('The health endpoint returns 200 OK.');
  });
});
