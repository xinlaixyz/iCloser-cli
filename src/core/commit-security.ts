import { existsSync, realpathSync } from 'fs';
import * as path from 'path';

export interface CommitSecurityConfig {
  security?: {
    sensitiveFiles?: string[];
  };
}

export interface CommitSafetyResult {
  ok: boolean;
  reason?: string;
  file?: string;
}

const DEFAULT_SENSITIVE_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_ed25519',
  'secrets/**',
  '.aws/**',
  '.ssh/**',
];

/** Glob pattern matcher for sensitive-file checks.
 * Supports: *.ext, dir/**, dir/*, **\/dir, {a,b}, exact, * wildcards.
 * No dependencies required; intentionally small and deterministic. */
export function matchSensitivePattern(name: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  const n = name.toLowerCase().replace(/\\/g, '/');

  const braceMatch = p.match(/^(.+)\{([^}]+)\}(.*)$/);
  if (braceMatch) {
    const options = braceMatch[2].split(',');
    return options.some(opt => matchSensitivePattern(name, braceMatch[1] + opt + braceMatch[3]));
  }

  if (p.includes('**')) {
    const parts = p.split('**');
    if (parts.length === 2) {
      const prefix = parts[0];
      const suffix = parts[1];
      if (!suffix) return n.startsWith(prefix);
      const cleanSuffix = suffix.startsWith('/') ? suffix.slice(1) : suffix;
      return n.startsWith(prefix) && n.endsWith(cleanSuffix);
    }
  }

  if (p.includes('*')) {
    const regexStr = '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$';
    try { return new RegExp(regexStr).test(n); } catch { return false; }
  }

  return n === p || n.endsWith('/' + p);
}

export function getCommitSensitivePatterns(config?: CommitSecurityConfig): string[] {
  return [...DEFAULT_SENSITIVE_PATTERNS, ...(config?.security?.sensitiveFiles ?? [])];
}

export function validateCommitSafety(
  rootPath: string,
  message: string,
  files: string[],
  config?: CommitSecurityConfig,
): CommitSafetyResult {
  if (!message.trim()) return { ok: false, reason: 'empty commit message' };
  if (files.length === 0) return { ok: false, reason: 'empty file list' };

  const rootResolved = path.resolve(rootPath);
  const rootReal = safeRealpath(rootResolved) ?? rootResolved;
  const sensitivePatterns = getCommitSensitivePatterns(config);

  for (const file of files) {
    const normalized = file.replace(/\\/g, '/').trim();
    if (!normalized) return { ok: false, reason: 'empty file path' };

    const absolute = path.resolve(rootResolved, normalized);
    const rel = path.relative(rootResolved, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, reason: 'path escapes repository root', file };
    }

    if (existsSync(absolute)) {
      const real = safeRealpath(absolute);
      if (real) {
        const realRel = path.relative(rootReal, real);
        if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
          return { ok: false, reason: 'realpath escapes repository root', file };
        }
      }
    }

    const base = path.basename(normalized);
    if (sensitivePatterns.some(p => matchSensitivePattern(base, p) || matchSensitivePattern(normalized, p))) {
      return { ok: false, reason: 'sensitive file blocked', file };
    }
  }

  return { ok: true };
}

function safeRealpath(target: string): string | null {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}
