// Git utilities for iCloser Agent Shell
import { execSync } from 'child_process';
import * as path from 'path';

export interface GitStatus {
  branch: string;
  clean: boolean;
  changed: string[];
  untracked: string[];
  staged: string[];
}

export function isGitRepo(rootPath: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: rootPath,
      stdio: 'pipe',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

export function getGitRoot(rootPath: string): string {
  return execSync('git rev-parse --show-toplevel', {
    cwd: rootPath,
    encoding: 'utf-8',
    timeout: 5000,
  }).trim();
}

export function getCurrentBranch(rootPath: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: rootPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function getGitStatus(rootPath: string): GitStatus {
  const output = execSync('git status --porcelain', {
    cwd: rootPath,
    encoding: 'utf-8',
    timeout: 5000,
  });

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
    // Stage specific files
    for (const file of files) {
      execSync(`git add "${file}"`, { cwd: rootPath, timeout: 10000 });
    }

    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: rootPath,
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

export function getDiff(rootPath: string, staged = false): string {
  const args = staged ? 'git diff --staged' : 'git diff';
  try {
    return execSync(args, {
      cwd: rootPath,
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

export function getLog(rootPath: string, count = 10): string {
  try {
    return execSync(`git log --oneline -${count}`, {
      cwd: rootPath,
      encoding: 'utf-8',
      timeout: 5000,
    });
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
    execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
      cwd: rootPath,
      timeout: 30000,
    });
    return true;
  } catch {
    return false;
  }
}

export function removeWorktree(rootPath: string, worktreePath: string): boolean {
  try {
    execSync(`git worktree remove "${worktreePath}"`, {
      cwd: rootPath,
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

export function createStash(rootPath: string, message: string): string | null {
  try {
    const output = execSync(`git stash create "${message}"`, {
      cwd: rootPath,
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export function applyStash(rootPath: string, stashRef: string): boolean {
  try {
    execSync(`git stash apply "${stashRef}"`, {
      cwd: rootPath,
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}
