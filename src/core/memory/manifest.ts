// Agent manifest memory — imports Codex/Claude/Copilot project instruction files
// into Semantic Memory, and exports project rules back to an AGENTS.md file.
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import type { SemanticMemory, SemanticRule } from './semantic.js';

export const DEFAULT_MEMORY_MANIFESTS = [
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
  '.cursor/rules',
];

export interface MemoryManifestImportResult {
  filesScanned: number;
  filesImported: number;
  rulesAdded: number;
  sources: Array<{ file: string; rules: number }>;
}

export interface ManifestRuleDraft {
  sourceFile: string;
  content: string;
  heading: string;
}

export async function importAgentMemoryManifests(
  rootPath: string,
  semantic: SemanticMemory,
  files = DEFAULT_MEMORY_MANIFESTS
): Promise<MemoryManifestImportResult> {
  const result: MemoryManifestImportResult = {
    filesScanned: files.length,
    filesImported: 0,
    rulesAdded: 0,
    sources: [],
  };

  for (const file of files) {
    const fullPath = path.resolve(rootPath, file);
    if (!isInside(rootPath, fullPath) || !existsSync(fullPath)) continue;

    const statRules = await readManifestRules(fullPath, rootPath);
    if (statRules.length === 0) continue;

    let addedForFile = 0;
    for (const draft of statRules) {
      const before = semantic.totalRules;
      semantic.add({
        path: `AgentManifest/${normalizePath(draft.sourceFile)}/${draft.heading || 'General'}`,
        domain: 'AgentManifest',
        area: draft.heading || 'General',
        content: draft.content,
        scope: 'project',
        confidence: 0.8,
        verificationCount: 1,
        sourceEpisodeIds: [],
        tags: ['manifest', manifestTag(draft.sourceFile)],
        isPermanent: false,
      });
      if (semantic.totalRules > before) addedForFile++;
    }

    if (addedForFile > 0) {
      result.filesImported++;
      result.rulesAdded += addedForFile;
      result.sources.push({ file, rules: addedForFile });
    }
  }

  if (result.rulesAdded > 0) await semantic.save();
  return result;
}

export async function exportAgentMemoryManifest(
  rootPath: string,
  semantic: SemanticMemory,
  file = 'AGENTS.md'
): Promise<{ file: string; rulesExported: number }> {
  const fullPath = path.resolve(rootPath, file);
  if (!isInside(rootPath, fullPath)) {
    throw new Error(`Refusing to export memory outside project root: ${file}`);
  }

  const rules = semantic.query({ scope: 'project', limit: 200 })
    .filter(rule => rule.confidence >= 0.4);
  const content = renderAgentsManifest(rules);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
  return { file, rulesExported: rules.length };
}

export async function listAgentMemoryManifests(rootPath: string): Promise<Array<{ file: string; exists: boolean }>> {
  return DEFAULT_MEMORY_MANIFESTS.map(file => ({
    file,
    exists: existsSync(path.resolve(rootPath, file)),
  }));
}

async function readManifestRules(filePath: string, rootPath: string): Promise<ManifestRuleDraft[]> {
  const rel = normalizePath(path.relative(rootPath, filePath));
  const text = await readFile(filePath, 'utf-8');
  const lines = text.split(/\r?\n/);
  const drafts: ManifestRuleDraft[] = [];
  let heading = path.basename(filePath);
  let inCodeFence = false;
  let inFrontmatter = false;
  let frontmatterDelimCount = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence || !line) continue;

    // YAML frontmatter handling (--- at start of file only)
    if (line === '---' && frontmatterDelimCount < 2 && drafts.length === 0) {
      inFrontmatter = !inFrontmatter;
      frontmatterDelimCount++;
      continue;
    }
    if (inFrontmatter) continue; // skip YAML key: value pairs

    // HTML comments (skip entirely)
    if (line.startsWith('<!--')) continue;
    // Horizontal rule (--- in body, not frontmatter) — skip standalone ones
    if (line === '---') continue;

    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      heading = cleanMarkdown(headingMatch[1]);
      continue;
    }

    const bulletMatch = line.match(/^[-*+]\s+(.+)$/) || line.match(/^\d+[.)]\s+(.+)$/);
    const candidate = bulletMatch ? bulletMatch[1] : line;
    const content = cleanMarkdown(candidate);
    if (shouldImportLine(content)) {
      drafts.push({ sourceFile: rel, content, heading });
    }
  }

  return drafts;
}

function renderAgentsManifest(rules: SemanticRule[]): string {
  const lines = [
    '# AGENTS.md',
    '',
    'This file is generated from iCloser Memory Kernel project rules.',
    'Edit it directly when you want Codex, Claude Code, or other coding agents to share the same project instructions.',
    '',
    '## Project Instructions',
    '',
  ];

  if (rules.length === 0) {
    lines.push('- No project memory rules have been recorded yet.');
  } else {
    for (const rule of rules) {
      lines.push(`- ${rule.content}`);
    }
  }

  lines.push('', '## Maintenance', '', '- Refresh from memory with `ic mem export AGENTS.md`.');
  lines.push('- Import edits with `ic mem import AGENTS.md`.');
  lines.push('');
  return lines.join('\n');
}

function shouldImportLine(content: string): boolean {
  if (content.length < 8 || content.length > 500) return false;
  if (/^https?:\/\//i.test(content)) return false;
  if (/^(usage|options|examples?)[:：]?$/i.test(content)) return false;
  return /must|should|prefer|avoid|never|always|use|run|test|commit|安全|必须|应该|避免|不要|禁止|总是|优先|使用|运行|测试/i.test(content);
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

function manifestTag(file: string): string {
  const normalized = normalizePath(file).toLowerCase();
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('copilot')) return 'copilot';
  if (normalized.includes('cursor')) return 'cursor';
  return 'agents';
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, '/');
}

function isInside(rootPath: string, targetPath: string): boolean {
  const rel = path.relative(path.resolve(rootPath), targetPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
