// S20.4 Diff Red/Green Renderer — unified diff parsing and colored output
import chalk from 'chalk';

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffFile {
  file: string;
  hunks: DiffHunk[];
}

export interface PendingDiffFileSummary {
  file: string;
  additions: number;
  deletions: number;
  risk: 'low' | 'medium' | 'high';
  likelyIntent: string;
  verification: string[];
}

export interface PendingDiffSummary {
  fileCount: number;
  additions: number;
  deletions: number;
  highestRisk: 'low' | 'medium' | 'high';
  files: PendingDiffFileSummary[];
  nextChecks: string[];
}

export function parseDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileLines = diffText.split('\n');
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldCounter = 0;
  let newCounter = 0;

  for (const line of fileLines) {
    // File header: diff --git a/file b/file or --- a/file or +++ b/file
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)/);
    if (fileMatch) {
      if (currentFile) files.push(currentFile);
      currentFile = { file: fileMatch[1], hunks: [] };
      currentHunk = null;
      continue;
    }
    const newFileMatch = line.match(/^\+\+\+ b\/(.+)/);
    if (newFileMatch && currentFile) {
      currentFile.file = newFileMatch[1];
      continue;
    }
    if (line.startsWith('--- a/') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      continue;
    }

    // Hunk header: @@ -a,b +c,d @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
    if (hunkMatch) {
      if (currentFile) {
        oldCounter = parseInt(hunkMatch[1], 10);
        newCounter = parseInt(hunkMatch[3], 10);
        currentHunk = { oldStart: oldCounter, newStart: newCounter, lines: [] };
        currentFile.hunks.push(currentHunk);
      }
      continue;
    }

    if (!currentFile || !currentHunk) continue;

    if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'removed', oldLine: oldCounter++, content: line.substring(1) });
    } else if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'added', newLine: newCounter++, content: line.substring(1) });
    } else if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({
        type: 'context',
        oldLine: oldCounter++,
        newLine: newCounter++,
        content: line.substring(1) || '',
      });
    }
  }
  if (currentFile && currentFile.hunks.length > 0) files.push(currentFile);
  return files;
}

export function renderDiff(files: DiffFile[], maxWidth = 80): string {
  if (files.length === 0) return '  无变更';

  const parts: string[] = [];
  const mw = Math.min(maxWidth, process.stdout.columns ? process.stdout.columns - 4 : 76);

  for (const file of files) {
    parts.push(`\n  ${chalk.bold.cyan(file.file)}`);
    parts.push(`  ${chalk.dim('─'.repeat(Math.min(mw, 60)))}`);

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        let prefix: string;
        let colored: string;
        const display = line.content.length > mw - 6 ? line.content.substring(0, mw - 9) + '…' : line.content;

        if (line.type === 'added') {
          prefix = chalk.green('+');
          colored = chalk.green(display);
        } else if (line.type === 'removed') {
          prefix = chalk.red('─');
          colored = chalk.red(display);
        } else {
          prefix = ' ';
          colored = chalk.dim(display);
        }

        const oldNum = line.oldLine !== undefined ? chalk.dim(String(line.oldLine).padStart(3)) : '   ';
        const newNum = line.newLine !== undefined ? chalk.dim(String(line.newLine).padStart(3)) : '   ';
        parts.push(`  ${oldNum} ${newNum} ${prefix} ${colored}`);
      }
    }
  }
  return parts.join('\n');
}

export function renderDiffBrief(files: DiffFile[]): string {
  const stats: string[] = [];
  for (const file of files) {
    let added = 0;
    let removed = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'added') added++;
        else if (line.type === 'removed') removed++;
      }
    }
    stats.push(`  ${chalk.cyan(file.file)}  ${chalk.green(`+${added}`)} ${chalk.red(`-${removed}`)}`);
  }
  return stats.join('\n');
}

export function buildPendingDiffSummary(files: { path: string; content: string; previousContent?: string }[]): PendingDiffSummary {
  const summaries = files.map(file => {
    const previous = (file.previousContent || '').split('\n');
    const next = file.content.split('\n');
    const additions = Math.max(0, next.length - commonLineCount(previous, next));
    const deletions = file.previousContent === undefined ? 0 : Math.max(0, previous.length - commonLineCount(previous, next));
    const likelyIntent = inferPendingIntent(file.path, file.content, file.previousContent || '');
    const risk = inferPendingRisk(file.path, additions, deletions, next.length);
    return {
      file: file.path,
      additions,
      deletions,
      risk,
      likelyIntent,
      verification: inferPendingVerification(file.path, likelyIntent),
    };
  });
  const additions = summaries.reduce((sum, file) => sum + file.additions, 0);
  const deletions = summaries.reduce((sum, file) => sum + file.deletions, 0);
  const nextChecks = [...new Set(summaries.flatMap(file => file.verification))];
  return {
    fileCount: summaries.length,
    additions,
    deletions,
    highestRisk: highestRisk(summaries.map(file => file.risk)),
    files: summaries,
    nextChecks: nextChecks.length > 0 ? nextChecks : ['npx tsc --noEmit', 'npm run lint'],
  };
}

export function renderPendingDiffSummary(summary: PendingDiffSummary): string {
  if (summary.fileCount === 0) return '没有待写入文件。';
  const riskLabel = summary.highestRisk === 'high' ? chalk.red('高') : summary.highestRisk === 'medium' ? chalk.yellow('中') : chalk.green('低');
  const lines = [
    `摘要 ${summary.fileCount} 个文件，新增 ${summary.additions} 行，删除 ${summary.deletions} 行，整体风险 ${riskLabel}`,
    '变更：',
    ...summary.files.slice(0, 6).map(file => {
      const risk = file.risk === 'high' ? chalk.red('高') : file.risk === 'medium' ? chalk.yellow('中') : chalk.green('低');
      return `- ${file.file}  +${file.additions}/-${file.deletions}  风险:${risk}  ${file.likelyIntent}`;
    }),
    ...(summary.files.length > 6 ? [`- 还有 ${summary.files.length - 6} 个文件未展开`] : []),
    `建议验证：${summary.nextChecks.slice(0, 4).join(' / ')}`,
  ];
  return lines.join('\n');
}

export function filesToDiff(files: { path: string; content: string; previousContent?: string }[]): string {
  // Generate a simple unified diff from file contents
  const parts: string[] = [];
  for (const f of files) {
    const _oldLines = (f.previousContent || '').split('\n');
    const newLines = f.content.split('\n');
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(`@@ -0,0 +1,${newLines.length} @@`);
    for (const line of newLines) {
      parts.push(`+${line}`);
    }
  }
  return parts.join('\n');
}

function commonLineCount(a: string[], b: string[]): number {
  const set = new Set(a);
  return b.reduce((sum, line) => sum + (set.has(line) ? 1 : 0), 0);
}

function inferPendingIntent(file: string, added: string, removed: string): string {
  const text = `${file}\n${added}\n${removed}`.toLowerCase();
  if (/test|spec|vitest|jest/.test(text)) return '补充或调整测试验证。';
  if (/html|css|style|page|h5|mobile|login|button|input/.test(text)) return '交付可运行页面或前端交互。';
  if (/readme|docs?|\.md$/.test(text)) return '补充产品、使用或验收文档。';
  if (/memory|agents\.md|claude\.md/.test(text)) return '调整长期记忆或项目规则。';
  if (/provider|deepseek|openai|claude|anthropic|qwen/.test(text)) return '调整 AI Provider 或模型调用。';
  if (/repl|tool|shell|command|diff|verify/.test(text)) return '增强 REPL、工具或验证体验。';
  return '更新工程逻辑或项目文件。';
}

function inferPendingRisk(file: string, additions: number, deletions: number, totalLines: number): 'low' | 'medium' | 'high' {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  if (/security|provider|executor|git|config|index\.ts|repl\.ts/.test(normalized) && additions + deletions > 120) return 'high';
  if (additions + deletions > 300 || totalLines > 500) return 'high';
  if (/src\//.test(normalized) || additions + deletions > 100) return 'medium';
  return 'low';
}

function inferPendingVerification(file: string, intent: string): string[] {
  const checks = new Set<string>();
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  if (/\.(html|css)$/.test(normalized) || /页面|前端|交互/.test(intent)) {
    checks.add('浏览器打开页面检查布局和交互');
    checks.add('npm run lint');
    return [...checks];
  }
  checks.add('npx tsc --noEmit');
  checks.add('npm run lint');
  if (/测试/.test(intent) || /\.(test|spec)\./.test(normalized)) checks.add('npm test');
  return [...checks];
}

function highestRisk(risks: Array<'low' | 'medium' | 'high'>): 'low' | 'medium' | 'high' {
  if (risks.includes('high')) return 'high';
  if (risks.includes('medium')) return 'medium';
  return 'low';
}
