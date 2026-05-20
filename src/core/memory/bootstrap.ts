// Memory Kernel Bootstrap — seed initial data from project history
// Git log → episodic events, code patterns → semantic rules
// Called automatically on `ic init` and manually via `ic mem bootstrap`
import { execSync } from 'child_process';
import type { EpisodicMemory } from './episodic.js';
import type { SemanticMemory, SemanticRule } from './semantic.js';
import type { MemoryRuntime } from './runtime.js';
import { memdbg } from './debug.js';

export interface BootstrapResult {
  gitCommits: number;
  episodesCreated: number;
  rulesCreated: number;
  patternsFound: string[];
  errors: string[];
}

/** Seed episodic memory from git history (recent 50 commits) */
async function seedFromGitHistory(
  rootPath: string,
  episodic: EpisodicMemory
): Promise<{ commits: number; episodes: number }> {
  let commits = 0;
  let episodes = 0;

  try {
    const log = execSync(
      'git log --oneline --name-only -50 --format="COMMIT:%h %s %ai"',
      { cwd: rootPath, encoding: 'utf-8', timeout: 5000, maxBuffer: 1024 * 1024, stdio: 'pipe' }
    );

    const entries = log.split('COMMIT:').filter(Boolean);
    commits = entries.length;

    for (const entry of entries) {
      const lines = entry.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      const [hash, ...msgParts] = lines[0].split(' ');
      const msg = msgParts.join(' ');
      const changedFiles = lines.slice(1).filter(f => f && f !== '.' && !f.startsWith('merge'));

      if (!msg) continue;

      // Determine episode type from commit message
      const isFix = /fix|修复|bug|错误/.test(msg);
      const isFeature = /feat|新增|添加|add|create|实现/.test(msg);
      const isRefactor = /refactor|重构|整理|优化/.test(msg);
      const isSecurity = /security|安全|漏洞/.test(msg);

      const type = isFix ? 'task_completed' :
                   isSecurity ? 'task_completed' :
                   isFeature ? 'task_completed' :
                   isRefactor ? 'task_completed' : 'task_completed';

      const importance = isFix ? 0.7 :
                         isSecurity ? 0.85 :
                         isFeature ? 0.5 : 0.35;

      await episodic.record({
        type,
        summary: msg.slice(0, 200),
        details: `Commit ${hash}: ${msg}\n变更文件: ${changedFiles.slice(0, 10).join(', ')}`,
        importance,
        tags: [
          'git-history',
          isFix ? 'fix' : isFeature ? 'feature' : 'change',
          ...changedFiles.filter(f => f.includes('.')).map(f => f.split('.').pop()!).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3),
        ],
        changedFiles: changedFiles.slice(0, 10),
        relatedEpisodeIds: [],
        timestamp: extractDate(lines[0]),
      });
      episodes++;
    }

    memdbg.info('bootstrap', `Git 历史导入: ${commits} commits → ${episodes} 事件`);
  } catch {
    memdbg.warn('bootstrap', `Git 历史读取失败 (非 git 仓库或空仓库)`);
  }

  return { commits, episodes };
}

/** Extract patterns from codebase → initial semantic rules */
async function seedFromCodePatterns(
  rootPath: string,
  semantic: SemanticMemory
): Promise<{ patterns: string[]; rules: number }> {
  const patterns: string[] = [];
  let rulesCreated = 0;

  try {
    // Read project configs to detect patterns
    const { fileExists, readFile } = await import('../../utils/fs.js');
    const path = await import('path');

    // Pattern 1: TypeScript strict mode → rule about type safety
    const tsconfigPath = path.join(rootPath, 'tsconfig.json');
    if (await fileExists(tsconfigPath)) {
      try {
        const tsconfig = JSON.parse(await readFile(tsconfigPath));
        if (tsconfig?.compilerOptions?.strict) {
          patterns.push('TypeScript strict 模式已启用');
          addRuleIfNew(semantic, {
            path: 'TypeScript/类型安全', domain: 'Frontend', scope: 'project',
            content: '项目启用了 TypeScript strict 模式，所有修改必须通过严格类型检查',
            confidence: 0.7, tags: ['typescript', 'strict', 'auto-detected'],
          });
          rulesCreated++;
        }
      } catch { /* ignore invalid tsconfig */ }
    }

    // Pattern 2: ESLint config → code style rules
    const hasESLint = await fileExists(path.join(rootPath, '.eslintrc.json')) ||
                      await fileExists(path.join(rootPath, '.eslintrc.js')) ||
                      await fileExists(path.join(rootPath, 'eslint.config.js'));
    if (hasESLint) {
      patterns.push('ESLint 代码规范已配置');
      addRuleIfNew(semantic, {
        path: 'CodeStyle/ESLint', domain: 'General', scope: 'project',
        content: '项目配置了 ESLint，生成的代码必须符合 ESLint 规则',
        confidence: 0.6, tags: ['eslint', 'code-style', 'auto-detected'],
      });
      rulesCreated++;
    }

    // Pattern 3: Test framework detection
    const hasVitest = await fileExists(path.join(rootPath, 'vitest.config.ts')) ||
                      await fileExists(path.join(rootPath, 'vitest.config.js'));
    const hasJest = await fileExists(path.join(rootPath, 'jest.config.js')) ||
                    await fileExists(path.join(rootPath, 'jest.config.ts'));
    if (hasVitest || hasJest) {
      const framework = hasVitest ? 'Vitest' : 'Jest';
      patterns.push(`${framework} 测试框架已配置`);
      addRuleIfNew(semantic, {
        path: `Testing/${framework}`, domain: 'General', scope: 'project',
        content: `项目使用 ${framework} 作为测试框架，修改源码时应同步更新或补充测试`,
        confidence: 0.6, tags: ['testing', framework.toLowerCase(), 'auto-detected'],
      });
      rulesCreated++;
    }

    // Pattern 4: Check if project has build scripts
    const pkgPath = path.join(rootPath, 'package.json');
    if (await fileExists(pkgPath)) {
      try {
        const pkg = JSON.parse(await readFile(pkgPath));
        if (pkg.scripts?.build) {
          patterns.push(`构建命令: npm run ${pkg.scripts.build.includes('tsc') ? 'build (TypeScript)' : 'build'}`);
        }
        if (pkg.scripts?.test) {
          patterns.push(`测试命令: npm run ${pkg.scripts.test.includes('vitest') ? 'test (Vitest)' : 'test'}`);
        }
      } catch { /* ignore */ }
    }

    // Pattern 5: Dockerfile → deployment awareness
    if (await fileExists(path.join(rootPath, 'Dockerfile'))) {
      patterns.push('Docker 容器化部署');
      addRuleIfNew(semantic, {
        path: 'DevOps/Docker', domain: 'DevOps', scope: 'project',
        content: '项目使用 Docker 部署，修改依赖或构建脚本后需验证 Docker 构建是否成功',
        confidence: 0.5, tags: ['docker', 'deployment', 'auto-detected'],
      });
      rulesCreated++;
    }

    // Pattern 6: Detect common module patterns from source file names
    try {
      const { findFiles } = await import('../../utils/fs.js');
      const sourceFiles = await findFiles(rootPath, ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']);
      const fileNames = sourceFiles.map(f => path.basename(f).toLowerCase());

      if (fileNames.some(f => f.includes('.test.') || f.includes('.spec.'))) {
        patterns.push('存在测试文件，项目有测试覆盖');
      }
      if (fileNames.some(f => f.includes('middleware'))) {
        addRuleIfNew(semantic, {
          path: 'Architecture/Middleware', domain: 'Backend', scope: 'project',
          content: '项目使用中间件模式，新增功能时应考虑是否需要在中间件层处理',
          confidence: 0.4, tags: ['middleware', 'architecture', 'auto-detected'],
        });
        rulesCreated++;
      }
    } catch { /* patterns are optional */ }

    memdbg.info('bootstrap', `代码模式提取: ${patterns.length} 个模式 → ${rulesCreated} 条规则`);
  } catch {
    memdbg.warn('bootstrap', `代码模式提取失败`);
  }

  return { patterns, rules: rulesCreated };
}

/** Main bootstrap entry: seed all memory stores from project history */
export async function bootstrapMemoryKernel(
  rootPath: string,
  runtime: MemoryRuntime
): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    gitCommits: 0,
    episodesCreated: 0,
    rulesCreated: 0,
    patternsFound: [],
    errors: [],
  };

  // Step 1: Seed episodic from git history
  try {
    const gitResult = await seedFromGitHistory(rootPath, runtime.episodic);
    result.gitCommits = gitResult.commits;
    result.episodesCreated = gitResult.episodes;
  } catch (err) {
    result.errors.push(`Git历史导入失败: ${(err as Error).message}`);
  }

  // Step 2: Seed semantic from code patterns
  try {
    const patternResult = await seedFromCodePatterns(rootPath, runtime.semantic);
    result.patternsFound = patternResult.patterns;
    result.rulesCreated += patternResult.rules;
  } catch (err) {
    result.errors.push(`代码模式提取失败: ${(err as Error).message}`);
  }

  // Step 3: Run consolidation to detect cross-commit patterns
  try {
    const consolidationResult = await runtime.runConsolidation();
    result.rulesCreated += consolidationResult;
  } catch (err) {
    result.errors.push(`初始固化失败: ${(err as Error).message}`);
  }

  // Step 4: Save
  try {
    await runtime.semantic.save();
    memdbg.info('bootstrap', `Bootstrap 完成: ${result.episodesCreated} 事件, ${result.rulesCreated} 规则`);
  } catch (err) {
    result.errors.push(`保存失败: ${(err as Error).message}`);
  }

  return result;
}

// ── Helpers ──

function addRuleIfNew(
  semantic: SemanticMemory,
  rule: Omit<SemanticRule, 'id' | 'created_at' | 'updated_at' | 'verificationCount' | 'sourceEpisodeIds' | 'isPermanent'>
): void {
  const exists = semantic.query({ searchText: rule.content.slice(0, 50) }).length > 0;
  if (!exists) {
    semantic.add({
      ...rule,
      verificationCount: 1,
      sourceEpisodeIds: [],
      isPermanent: false,
    });
  }
}

function extractDate(line: string): string {
  // Format: COMMIT:abc1234 message 2026-05-19 12:34:56 +0800
  const match = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (match) return match[1].replace(' ', 'T') + 'Z';
  return new Date().toISOString();
}
