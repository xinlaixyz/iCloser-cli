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

export function filesToDiff(files: { path: string; content: string; previousContent?: string }[]): string {
  // Generate a simple unified diff from file contents
  const parts: string[] = [];
  for (const f of files) {
    const oldLines = (f.previousContent || '').split('\n');
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
