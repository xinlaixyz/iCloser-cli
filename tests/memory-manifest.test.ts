import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SemanticMemory } from '../src/core/memory/semantic.js';
import {
  exportAgentMemoryManifest,
  importAgentMemoryManifests,
  listAgentMemoryManifests,
} from '../src/core/memory/manifest.js';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mem-manifest-'));
  roots.push(root);
  return root;
}

afterAll(async () => {
  for (const root of roots) {
    try { await rm(root, { recursive: true, force: true }); } catch {}
  }
});

function makeSemantic(root: string): SemanticMemory {
  return new SemanticMemory({
    semanticRulesPath: join(root, '.agent', 'memory', 'long-term', 'semantic', 'rules.json'),
    semanticTreePath: join(root, '.agent', 'memory', 'long-term', 'semantic', 'tree.md'),
    sqlite: { isOpen: false, query: () => [], insert: () => {}, deleteByKey: () => {} },
  } as any);
}

describe('agent memory manifests', () => {
  it('imports project rules from AGENTS.md and CLAUDE.md', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'AGENTS.md'), [
      '# Project Rules',
      '',
      '- Always run npm test before final delivery.',
      '- Prefer TypeScript strict mode.',
      '',
      '```',
      '- Never import this code fence line.',
      '```',
    ].join('\n'));
    await writeFile(join(root, 'CLAUDE.md'), [
      '# Claude Memory',
      '',
      '- 必须先阅读 PRD 再修改代码。',
      '- 不要修改用户未授权的文件。',
    ].join('\n'));

    const semantic = makeSemantic(root);
    const result = await importAgentMemoryManifests(root, semantic);

    expect(result.filesImported).toBe(2);
    expect(result.rulesAdded).toBe(4);
    expect(semantic.searchRelevant('npm test delivery')).toHaveLength(1);
    expect(semantic.searchRelevant('阅读 PRD')).toHaveLength(1);
    expect(semantic.searchRelevant('code fence')).toHaveLength(0);
  });

  it('lists supported manifest files', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'AGENTS.md'), '- Always write tests.');

    const files = await listAgentMemoryManifests(root);

    expect(files.find(file => file.file === 'AGENTS.md')?.exists).toBe(true);
    expect(files.some(file => file.file === 'CLAUDE.md')).toBe(true);
  });

  it('exports semantic rules to AGENTS.md', async () => {
    const root = await makeRoot();
    const semantic = makeSemantic(root);
    semantic.add({
      path: 'General/Testing',
      domain: 'General',
      content: 'Always run npm test before delivery.',
      scope: 'project',
      confidence: 0.8,
      verificationCount: 1,
      sourceEpisodeIds: [],
      tags: ['testing'],
      isPermanent: false,
    });

    const result = await exportAgentMemoryManifest(root, semantic, 'AGENTS.md');
    const content = await readFile(join(root, 'AGENTS.md'), 'utf-8');

    expect(result.rulesExported).toBe(1);
    expect(content).toContain('Always run npm test before delivery.');
    expect(content).toContain('ic mem import AGENTS.md');
  });

  it('refuses to export outside project root', async () => {
    const root = await makeRoot();
    const semantic = makeSemantic(root);

    await expect(exportAgentMemoryManifest(root, semantic, '../AGENTS.md')).rejects.toThrow('outside project root');
  });
});
