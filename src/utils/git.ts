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

/** Glob pattern matcher for sensitive-file checks.
 *  Supports: *.ext, dir/**, dir/*, **\/dir, {a,b}, exact, * wildcards.
 *  No dependencies required — purposefully minimal. */
function matchSensitivePattern(name: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  const n = name.toLowerCase().replace(/\\/g, '/');

  // {a,b,c} alternation → expand to multiple patterns
  const braceMatch = p.match(/^(.+)\{([^}]+)\}(.*)$/);
  if (braceMatch) {
    const options = braceMatch[2].split(',');
    return options.some(opt => matchSensitivePattern(name, braceMatch[1] + opt + braceMatch[3]));
  }

  // ** recursive match: dir/** → matches dir/ and anything under
  if (p.includes('**')) {
    const parts = p.split('**');
    if (parts.length === 2) {
      const prefix = parts[0]; // e.g. "src/"
      const suffix = parts[1]; // e.g. "/*.ts" or ""
      if (!suffix) return n.startsWith(prefix);                    // dir/**
      const cleanSuffix = suffix.startsWith('/') ? suffix.slice(1) : suffix;
      return n.startsWith(prefix) && n.endsWith(cleanSuffix);       // dir/**/*.ts
    }
  }

  // * wildcard (non-recursive, single-segment)
  if (p.includes('*')) {
    const regexStr = '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$';
    try { return new RegExp(regexStr).test(n); } catch { return false; }
  }

  // Exact match or suffix match
  return n === p || n.endsWith('/' + p);
}

export function createCommit(
  rootPath: string,
  message: string,
  files: string[],
  /** Optional security config (forward-compat, existing callers pass nothing). */
  config?: { security?: { sensitiveFiles?: string[] } }
): boolean {
  // ── Pre-flight validation ──────────────────────────────────
  if (!message.trim()) return false;                      // empty message

  const sensitivePatterns = config?.security?.sensitiveFiles ?? [];
  const rootResolved = path.resolve(rootPath);

  for (const file of files) {
    // Path-traversal guard: file must stay inside rootPath
    const rel = path.relative(rootResolved, path.resolve(rootPath, file));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;

    // Sensitive-file guard: reject .env, *.pem, *.key, etc.
    const base = path.basename(file);
    if (sensitivePatterns.some(p => matchSensitivePattern(base, p) || matchSensitivePattern(file, p))) {
      return false;
    }
  }

  // ── Execute ───────────────────────────────────────────────
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
