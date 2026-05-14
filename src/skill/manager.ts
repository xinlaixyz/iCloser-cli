// Skill Manager — skill lifecycle, registry, composition
import * as path from 'path';
import { fileExists, readJson, writeJson, readFile, ensureDir, listDir } from '../utils/fs.js';
import fse from 'fs-extra';
import type { Skill, SkillManifest } from '../types.js';

// ============================================================
// Skill Registry (built-in)
// ============================================================
const BUILTIN_SKILLS: Skill[] = [
  {
    manifest: {
      name: 'project-index',
      version: '1.0.0',
      description: '项目扫描与索引：自动识别语言/框架/DB，构建代码图谱',
      triggers: ['扫描', '索引', '分析项目', 'scan', 'index'],
      requires: [],
      provider: 'claude',
      type: 'builtin',
    },
    systemPrompt: '你是项目索引专家。扫描项目文件结构，识别技术栈，构建依赖图谱。',
    tools: ['scan-project', 'detect-tech-stack', 'build-dependency-graph'],
    knowledgeBase: [],
    installed: true,
    enabled: true,
    installPath: 'builtin',
  },
  {
    manifest: {
      name: 'code-review',
      version: '1.0.0',
      description: '代码审查：检查代码质量、风格一致性、潜在 bug',
      triggers: ['审查', 'review', '检查代码', 'code quality'],
      requires: ['project-index'],
      provider: 'claude',
      type: 'builtin',
    },
    systemPrompt: '你是代码审查专家。检查代码风格一致性、潜在 bug、安全漏洞、性能问题。',
    tools: ['review-diff', 'check-style', 'detect-bugs', 'suggest-improvements'],
    knowledgeBase: ['code-smells', 'common-bugs'],
    installed: true,
    enabled: true,
    installPath: 'builtin',
  },
  {
    manifest: {
      name: 'security-review',
      version: '1.0.0',
      description: '安全审查：注入检测、敏感数据扫描、权限边界验证',
      triggers: ['安全', 'security', '注入', '漏洞', '扫描漏洞'],
      requires: ['project-index'],
      provider: 'claude',
      type: 'builtin',
    },
    systemPrompt: '你是安全审查专家。检测 SQL 注入、XSS、硬编码密钥、不安全权限配置。',
    tools: ['scan-secrets', 'check-injection', 'verify-permissions', 'audit-dependencies'],
    knowledgeBase: ['owasp-top10', 'common-cve', 'secure-coding'],
    installed: true,
    enabled: false,
    installPath: 'builtin',
  },
  {
    manifest: {
      name: 'test-gen',
      version: '1.0.0',
      description: '测试生成：自动生成单元测试、集成测试、边界测试',
      triggers: ['生成测试', '测试用例', 'test generation', '写测试'],
      requires: ['project-index'],
      provider: 'claude',
      type: 'builtin',
    },
    systemPrompt: '你是测试生成专家。为新代码和修改代码生成高质量测试用例。确保边界覆盖和异常路径。',
    tools: ['generate-unit-tests', 'generate-integration-tests', 'generate-edge-cases'],
    knowledgeBase: ['testing-patterns', 'coverage-strategies'],
    installed: true,
    enabled: false,
    installPath: 'builtin',
  },
  {
    manifest: {
      name: 'api-doc',
      version: '1.0.0',
      description: 'API 文档生成：自动检测接口变更并更新文档',
      triggers: ['文档', 'api 文档', '接口文档', 'documentation'],
      requires: ['project-index'],
      provider: 'claude',
      type: 'builtin',
    },
    systemPrompt: '你是 API 文档专家。检测接口变更，生成 OpenAPI/Swagger 兼容文档。',
    tools: ['detect-api-changes', 'generate-openapi', 'update-readme'],
    knowledgeBase: ['openapi-spec', 'api-design-guide'],
    installed: true,
    enabled: false,
    installPath: 'builtin',
  },
  {
    manifest: {
      name: 'local-tools',
      version: '1.0.0',
      description: '本地开发工具管理：安装、配置、升级 eslint/prettier/vitest 等常用工具',
      triggers: ['安装工具', '本地工具', '配置工具', 'eslint', 'prettier', 'jest', 'lint', '格式化', 'install tool', 'setup tool', 'local tools', 'dev tools', '开发工具'],
      requires: [],
      provider: 'claude',
      type: 'builtin',
    },
    systemPrompt: '你是本地开发工具管理专家。帮助用户在项目中安装、配置和维护 eslint、prettier、jest、vitest 等常用工具。',
    tools: ['install-tool', 'generate-tool-config', 'check-tools', 'upgrade-tool'],
    knowledgeBase: ['eslint-rules', 'prettier-options', 'jest-config', 'vitest-config'],
    installed: true,
    enabled: true,
    installPath: 'builtin',
  },
];

// ============================================================
// Skill Manager
// ============================================================
export class SkillManager {
  private skills: Map<string, Skill>;
  private rootPath: string;

  constructor(rootPath: string) {
    this.skills = new Map();
    this.rootPath = rootPath;

    // Load built-in skills
    for (const skill of BUILTIN_SKILLS) {
      this.skills.set(skill.manifest.name, { ...skill });
    }

    // Load project skills
    this.loadProjectSkills();
  }

  private async loadProjectSkills(): Promise<void> {
    const skillsDir = path.join(this.rootPath, '.icloser', 'skills');
    if (!(await fileExists(skillsDir))) return;

    try {
      const dirs = await listDir(skillsDir);
      for (const dir of dirs) {
        const manifestPath = path.join(skillsDir, dir, 'manifest.json');
        if (await fileExists(manifestPath)) {
          const manifest = await readJson(manifestPath) as unknown as SkillManifest;
          const skillPath = path.join(skillsDir, dir);
          const systemPromptPath = path.join(skillPath, 'system-prompt.md');

          this.skills.set(manifest.name, {
            manifest: { ...manifest, type: 'project' },
            systemPrompt: await this.loadSystemPrompt(systemPromptPath),
            tools: [],
            knowledgeBase: [],
            installed: true,
            enabled: true,
            installPath: skillPath,
          });
        }
      }
    } catch { /* ignore */ }
  }

  private async loadSystemPrompt(filePath: string): Promise<string> {
    try {
      return await readFile(filePath);
    } catch {
      return '';
    }
  }

  // List all skills
  list(options?: { enabled?: boolean; type?: SkillManifest['type'] }): Skill[] {
    let result = Array.from(this.skills.values());

    if (options?.enabled !== undefined) {
      result = result.filter(s => s.enabled === options.enabled);
    }
    if (options?.type) {
      result = result.filter(s => s.manifest.type === options.type);
    }

    return result.sort((a, b) => {
      // Built-in first, then alphabetical
      if (a.manifest.type === 'builtin' && b.manifest.type !== 'builtin') return -1;
      if (a.manifest.type !== 'builtin' && b.manifest.type === 'builtin') return 1;
      return a.manifest.name.localeCompare(b.manifest.name);
    });
  }

  // Get a specific skill
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  // Enable a skill
  enable(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    skill.enabled = true;
    this.skills.set(name, skill);
    return true;
  }

  // Disable a skill
  disable(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    skill.enabled = false;
    this.skills.set(name, skill);
    return true;
  }

  // Activate skill for next task
  use(name: string): Skill | null {
    const skill = this.skills.get(name);
    if (!skill) return null;
    // Mark as enabled if not already
    if (!skill.enabled) {
      skill.enabled = true;
      this.skills.set(name, skill);
    }
    return skill;
  }

  // Install a skill from a path or URL
  async install(source: string): Promise<Skill | null> {
    const skillName = path.basename(source).replace(/\.git$/, '').replace(/[^a-zA-Z0-9-]/g, '-');
    const skillsDir = path.join(this.rootPath, '.icloser', 'skills');
    const installPath = path.join(skillsDir, skillName);

    // Check if already installed
    if (this.skills.has(skillName)) {
      return null; // Already installed
    }

    // For GitHub URLs, would clone the repo
    // For local paths, would copy the directory
    if (source.startsWith('http')) {
      // In production, git clone the skill repo
      await ensureDir(installPath);
    } else if (await fileExists(source)) {
      await fse.copy(source, installPath);
    } else {
      return null;
    }

    // Try to read manifest
    const manifestPath = path.join(installPath, 'manifest.json');
    let manifest: SkillManifest;
    if (await fileExists(manifestPath)) {
      manifest = await readJson(manifestPath) as unknown as SkillManifest;
    } else {
      manifest = {
        name: skillName,
        version: '0.1.0',
        description: 'User-installed skill',
        triggers: [],
        requires: [],
        provider: 'claude',
        type: 'community',
      };
    }

    const skill: Skill = {
      manifest,
      systemPrompt: await this.loadSystemPrompt(path.join(installPath, 'system-prompt.md')),
      tools: [],
      knowledgeBase: [],
      installed: true,
      enabled: true,
      installPath,
    };

    this.skills.set(skillName, skill);

    // Save manifest if auto-generated
    await ensureDir(installPath);
    await writeJson(manifestPath, manifest);

    return skill;
  }

  // Remove a skill
  async remove(name: string): Promise<boolean> {
    const skill = this.skills.get(name);
    if (!skill) return false;

    // Can't remove built-in skills
    if (skill.manifest.type === 'builtin') return false;

    this.skills.delete(name);

    // Remove from disk
    if (skill.installPath !== 'builtin' && await fileExists(skill.installPath)) {
      await fse.remove(skill.installPath);
    }

    return true;
  }

  // Get enabled skills' system prompts combined
  getEnabledPrompts(): string[] {
    return this.list({ enabled: true })
      .filter(s => s.systemPrompt)
      .map(s => s.systemPrompt);
  }

  // Match triggers to find relevant skills for a task description
  matchSkills(description: string): Skill[] {
    const lower = description.toLowerCase();
    return this.list({ enabled: true })
      .filter(s => s.manifest.triggers.some(t => lower.includes(t.toLowerCase())));
  }

  // Get skill chain for a composite task
  getSkillChain(skillNames: string[]): Skill[] {
    const chain: Skill[] = [];
    const visited = new Set<string>();

    for (const name of skillNames) {
      this.collectWithDependencies(name, chain, visited);
    }

    return chain;
  }

  private collectWithDependencies(name: string, chain: Skill[], visited: Set<string>): void {
    if (visited.has(name)) return;
    visited.add(name);

    const skill = this.skills.get(name);
    if (!skill) return;

    // Resolve dependencies first
    for (const dep of skill.manifest.requires) {
      this.collectWithDependencies(dep, chain, visited);
    }

    chain.push(skill);
  }
}

// ============================================================
// Skill auto-generation
// ============================================================
export interface TaskPattern {
  triggerWords: string[];
  description: string;
  frequency: number;
  commonFiles: string[];
  commonChanges: string[];
}

export function detectSkillPattern(tasks: { description: string; changes: { file: string; intent: string }[] }[]): TaskPattern | null {
  if (tasks.length < 3) return null;

  // Group similar tasks by description keywords
  const allWords = tasks.flatMap(t => t.description.split(/\s+/).filter(w => w.length > 1));
  const wordFreq = new Map<string, number>();
  for (const w of allWords) {
    wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
  }

  // Find common trigger words (appear in >= 60% of tasks)
  const triggers = Array.from(wordFreq.entries())
    .filter(([_, count]) => count >= tasks.length * 0.6)
    .map(([word]) => word);

  if (triggers.length < 2) return null;

  // Find common files
  const allFiles = tasks.flatMap(t => t.changes.map(c => c.file));
  const fileFreq = new Map<string, number>();
  for (const f of allFiles) {
    fileFreq.set(f, (fileFreq.get(f) || 0) + 1);
  }

  const commonFiles = Array.from(fileFreq.entries())
    .filter(([_, count]) => count >= 2)
    .map(([file]) => file);

  return {
    triggerWords: triggers,
    description: `自动生成的 Skill — 基于 ${tasks.length} 次相似任务`,
    frequency: tasks.length,
    commonFiles,
    commonChanges: tasks.flatMap(t => t.changes.map(c => c.intent)),
  };
}
