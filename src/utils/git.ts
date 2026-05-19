// Git utilities for iCloser Agent Shell
import { execSync, execFileSync } from 'child_process';
import * as path from 'path';

function git(args: string[], rootPath: string, timeout = 10000, maxBuffer?: number): string {
  return execFileSync('git', args, { cwd: rootPath, timeout, encoding: 'utf-8', ...(maxBuffer ? { maxBuffer } : {}) });
}
function gitQuiet(args: string[], rootPath: string, timeout = 10000): string {
  return execFileSync('git', args, { cwd: rootPath, timeout, encoding: 'utf-8', stdio: 'pipe' });
}

export interface GitStatus {
  branch: string;
  clean: boolean;
  changed: string[];
  untracked: string[];
  staged: string[];
}

export function isGitRepo(rootPath: string): boolean {
  try {
    gitQuiet(['rev-parse', '--git-dir'], rootPath, 5000);
    return true;
  } catch {
    return false;
  }
}

export function getGitRoot(rootPath: string): string {
  return git(['rev-parse', '--show-toplevel'], rootPath, 5000).trim();
}

export function getCurrentBranch(rootPath: string): string {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], rootPath, 5000).trim();
  } catch {
    return 'unknown';
  }
}

export function getGitStatus(rootPath: string): GitStatus {
  const output = git(['status', '--porcelain'], rootPath, 5000);

  const staged: string[] = [];
  const changed: string[] = [];
  const untracked: string[] = [];

  for (const line of output.trim().split('\n').filter(Boolean)) {
    const status = line.substring(0, 2);
    const file = line.substring(3);

    if (status.startsWith('?')) untracked.push(file);
    else if (status[0] !== ' ') staged.push(file);
    else changed.push(file);
  }

  return {
    branch: getCurrentBranch(rootPath),
    clean: !output.trim(),
    changed,
    untracked,
    staged,
  };
}

export function createCommit(
  rootPath: string,
  message: string,
  files: string[]
): boolean {
  try {
    for (const file of files) {
      gitQuiet(['add', file], rootPath);
    }
    gitQuiet(['commit', '-m', message], rootPath);
    return true;
  } catch {
    return false;
  }
}

export function getDiff(rootPath: string, staged = false): string {
  const args = staged ? ['diff', '--staged'] : ['diff'];
  try {
    return git(args, rootPath, 15000, 10 * 1024 * 1024);
  } catch {
    return '';
  }
}

export function getLog(rootPath: string, count = 10): string {
  try {
    return git(['log', '--oneline', `-${count}`], rootPath, 5000);
  } catch {
    return '';
  }
}

export function createWorktree(
  rootPath: string,
  branchName: string,
  worktreePath: string
): boolean {
  try {
    gitQuiet(['worktree', 'add', worktreePath, '-b', branchName], rootPath, 30000);
    return true;
  } catch {
    return false;
  }
}

export function removeWorktree(rootPath: string, worktreePath: string): boolean {
  try {
    gitQuiet(['worktree', 'remove', worktreePath], rootPath, 15000);
    return true;
  } catch {
    return false;
  }
}

// T1-6e: WorktreeInfo type for git worktree isolation
export interface WorktreeInfo { path: string; branch: string; }
