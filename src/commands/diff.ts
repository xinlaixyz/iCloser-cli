import { Command } from 'commander';
import chalk from 'chalk';
import { jsonEnvelope } from '../cli/json.js';
import { detail, info, section, warn } from '../cli/output.js';
import { getDiff, getGitStatus, isGitRepo } from '../utils/git.js';

export interface DiffFileExplanation {
  file: string;
  additions: number;
  deletions: number;
  hunks: number;
  likelyIntent: string;
  risk: 'low' | 'medium' | 'high';
  verification: string[];
}

export interface DiffExplanation {
  changedFileCount: number;
  additions: number;
  deletions: number;
  files: DiffFileExplanation[];
  summary: string;
  nextChecks: string[];
}

interface DiffAccumulator {
  file: string;
  additions: number;
  deletions: number;
  hunks: number;
  addedLines: string[];
  removedLines: string[];
}

function normalizeDiffFile(line: string): string {
  const parts = line.split(' ');
  const target = parts[3] || parts[2] || '';
  return target.replace(/^b\//, '').replace(/^a\//, '');
}

function inferIntent(file: string, added: string, removed: string): string {
  const text = `${file}\n${added}\n${removed}`.toLowerCase();
  if (/test|spec|vitest|jest/.test(text)) return '补充或调整验证覆盖。';
  if (/readme|docs?|\.md$/.test(text)) return '补充产品、使用或验收文档。';
  if (/memory|mem|agents\.md|claude\.md/.test(text)) return '增强长期记忆读取、沉淀或解释体验。';
  if (/git|commit|pull request|pr|issue|collab/.test(text)) return '增强团队协作、提交或 PR 工作流。';
  if (/security|safe|realpath|policy|validate/.test(text)) return '增强安全策略或危险操作防护。';
  if (/repl|tool|executor|shell|command/.test(text)) return '增强工具执行、REPL 或命令可视化能力。';
  if (/provider|openai|claude|anthropic|deepseek|qwen/.test(text)) return '调整 AI Provider 或模型调用能力。';
  return '更新工程执行逻辑或项目配置。';
}

function inferRisk(file: string, additions: number, deletions: number, hunkCount: number): 'low' | 'medium' | 'high' {
  const lower = file.toLowerCase();
  if (/security|git|executor|repl|index\.ts|task-pipeline|provider/.test(lower) && hunkCount >= 3) return 'high';
  if (additions + deletions > 250 || hunkCount > 8) return 'high';
  if (/src\//.test(lower.replace(/\\/g, '/')) || additions + deletions > 80) return 'medium';
  return 'low';
}

function inferVerification(file: string, intent: string): string[] {
  const checks = new Set<string>();
  checks.add('npx tsc --noEmit');
  if (/测试|验证/.test(intent) || /\.(test|spec)\./.test(file)) checks.add('npm test');
  if (/文档/.test(intent)) checks.add('npm run lint');
  if (/长期记忆/.test(intent)) checks.add('npx vitest run tests/memory-experience.test.ts');
  if (/团队协作/.test(intent)) checks.add('npx vitest run tests/collaboration-commands.test.ts');
  if (/工具执行|REPL/.test(intent)) checks.add('npm run smoke:tools');
  if (checks.size === 1) checks.add('npm run lint');
  return [...checks];
}

function parseDiff(diff: string): DiffAccumulator[] {
  const files: DiffAccumulator[] = [];
  let current: DiffAccumulator | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { file: normalizeDiffFile(line), additions: 0, deletions: 0, hunks: 0, addedLines: [], removedLines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('@@')) current.hunks += 1;
    else if (line.startsWith('+')) {
      current.additions += 1;
      if (current.addedLines.length < 30) current.addedLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      current.deletions += 1;
      if (current.removedLines.length < 30) current.removedLines.push(line.slice(1));
    }
  }
  return files;
}

export function buildDiffExplanation(rootPath: string, options: { staged?: boolean } = {}): DiffExplanation {
  const diff = isGitRepo(rootPath) ? getDiff(rootPath, options.staged).trim() : '';
  const status = isGitRepo(rootPath) ? getGitStatus(rootPath) : { changed: [], staged: [], untracked: [] } as any;
  const parsed = parseDiff(diff);
  const files = parsed.map(file => {
    const added = file.addedLines.join('\n');
    const removed = file.removedLines.join('\n');
    const likelyIntent = inferIntent(file.file, added, removed);
    return {
      file: file.file,
      additions: file.additions,
      deletions: file.deletions,
      hunks: file.hunks,
      likelyIntent,
      risk: inferRisk(file.file, file.additions, file.deletions, file.hunks),
      verification: inferVerification(file.file, likelyIntent),
    };
  });
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const untrackedCount = Array.isArray(status.untracked) ? status.untracked.length : 0;
  const nextChecks = [...new Set(files.flatMap(file => file.verification))];
  return {
    changedFileCount: files.length + untrackedCount,
    additions,
    deletions,
    files,
    summary: files.length
      ? `检测到 ${files.length} 个 diff 文件，新增 ${additions} 行，删除 ${deletions} 行。`
      : untrackedCount
        ? `当前没有 tracked diff，但有 ${untrackedCount} 个未跟踪文件。`
        : '当前工作区没有可解释的 diff。',
    nextChecks: nextChecks.length > 0 ? nextChecks : ['npx tsc --noEmit', 'npm run lint', 'npm test'],
  };
}

export function printDiffExplanation(explanation: DiffExplanation): void {
  section('Diff Explain');
  detail('摘要', explanation.summary);
  if (explanation.files.length === 0) {
    info('没有 tracked diff 可解释。未跟踪文件请先确认是否需要纳入版本控制。');
    return;
  }
  console.log();
  for (const file of explanation.files.slice(0, 20)) {
    const risk = file.risk === 'high' ? chalk.red(file.risk) : file.risk === 'medium' ? chalk.yellow(file.risk) : chalk.green(file.risk);
    console.log(`  ${chalk.cyan(file.file)} ${chalk.dim(`+${file.additions}/-${file.deletions}, hunks ${file.hunks}`)} ${risk}`);
    console.log(`    ${file.likelyIntent}`);
    console.log(`    验证：${file.verification.join(' / ')}`);
  }
  if (explanation.files.length > 20) warn(`还有 ${explanation.files.length - 20} 个文件未在预览中展开。`);
  console.log();
  console.log(chalk.cyan('建议验收'));
  for (const check of explanation.nextChecks) console.log(`  - ${check}`);
}

export function registerDiffCommands(program: Command): void {
  program.command('explain-diff')
    .description('快捷入口：解释当前代码变更、风险和建议验证')
    .option('--staged', '只解释 staged diff')
    .option('--json', 'JSON 格式输出')
    .action((options?: { staged?: boolean; json?: boolean }) => {
      const explanation = buildDiffExplanation(process.cwd(), { staged: options?.staged });
      if (options?.json) console.log(JSON.stringify(jsonEnvelope('diff-explain', explanation), null, 2));
      else printDiffExplanation(explanation);
    });
}
