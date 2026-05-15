// Style Verifier — post-generation code style conformity check
import type { StyleFingerprint } from '../types.js';

export interface StyleViolation {
  file: string;
  line: number;
  rule: string;
  found: string;
  expected: string;
  severity: 'error' | 'warn';
}

export interface StyleCheckResult {
  pass: boolean;
  violations: StyleViolation[];
  summary: string;
}

export function verifyStyleConformity(
  code: string,
  filePath: string,
  fingerprint: StyleFingerprint,
): StyleCheckResult {
  const violations: StyleViolation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;

    // Skip empty lines and comments
    if (!line.trim() || /^\s*\/\/|\/\*|\*\/|\* |#/.test(line.trim())) continue;

    // 1. Semicolon check
    if (fingerprint.semicolons !== undefined && !/^\s*(import|export|interface|class|function|if|for|while|switch|catch)\b/.test(line.trim()) && !/^\s*[}/]\s*$/.test(line.trim())) {
      const endsWithSemi = line.trimEnd().endsWith(';');
      if (fingerprint.semicolons && !endsWithSemi && line.trim().length > 0) {
        violations.push({ file: filePath, line: ln, rule: '分号', found: '无分号', expected: '必须有分号', severity: 'warn' });
      }
      if (!fingerprint.semicolons && endsWithSemi) {
        violations.push({ file: filePath, line: ln, rule: '分号', found: '有分号', expected: '不能有分号', severity: 'warn' });
      }
    }

    // 2. Quote style check (string literals)
    if (fingerprint.quoteStyle === 'single') {
      const doubleQuotes = line.match(/(?<!\\)"(?!(?:[^"]*\{\{)[^"]*\}\})(?!,?\s*[:=])[^"]*"/);
      // Simpler: count single vs double quote string usage
    }
    if (fingerprint.quoteStyle && line.includes('"') && !line.includes('`')) {
      // Check if double-quoted strings exist when single is expected
      if (fingerprint.quoteStyle === 'single') {
        const dqCount = (line.match(/(?<!\\)"/g) || []).length;
        if (dqCount >= 2) {
          violations.push({ file: filePath, line: ln, rule: '引号', found: '双引号字符串', expected: '单引号字符串', severity: 'warn' });
        }
      }
      if (fingerprint.quoteStyle === 'double') {
        const sqCount = (line.match(/(?<!\\)'/g) || []).length;
        if (sqCount >= 2) {
          violations.push({ file: filePath, line: ln, rule: '引号', found: '单引号字符串', expected: '双引号字符串', severity: 'warn' });
        }
      }
    }

    // 3. Naming convention check
    if (fingerprint.namingConvention) {
      // Check function declarations
      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        const name = funcMatch[1];
        const violates = checkNaming(name, fingerprint.namingConvention);
        if (violates) {
          violations.push({ file: filePath, line: ln, rule: '命名', found: name, expected: fingerprint.namingConvention, severity: 'error' });
        }
      }
      // Check const declarations (variable naming)
      const constMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)/);
      if (constMatch) {
        const name = constMatch[1];
        if (/^[A-Z_]+$/.test(name)) continue; // CONSTANTS are always UPPER_CASE
        const violates = checkNaming(name, fingerprint.namingConvention);
        if (violates) {
          violations.push({ file: filePath, line: ln, rule: '命名', found: name, expected: fingerprint.namingConvention, severity: 'warn' });
        }
      }
    }
  }

  // Cap violations at 20
  const capped = violations.slice(0, 20);
  const errorCount = capped.filter(v => v.severity === 'error').length;
  const warnCount = capped.filter(v => v.severity === 'warn').length;
  const pass = errorCount === 0;

  return {
    pass,
    violations: capped,
    summary: `风格检查: ${pass ? '通过' : '未通过'} (${errorCount} 错误, ${warnCount} 警告, 共 ${violations.length} 处)`,
  };
}

function checkNaming(name: string, convention: StyleFingerprint['namingConvention']): boolean {
  switch (convention) {
    case 'camelCase': return !/^[a-z][a-zA-Z0-9]*$/.test(name);
    case 'PascalCase': return !/^[A-Z][a-zA-Z0-9]*$/.test(name);
    case 'snake_case': return !/^[a-z][a-z0-9_]*$/.test(name);
    case 'kebab-case': return !/^[a-z][a-z0-9-]*$/.test(name);
    default: return false;
  }
}

// Quick check: verify multiple files at once
export async function verifyFilesStyle(
  files: { path: string; content: string }[],
  fingerprint: StyleFingerprint,
): Promise<StyleCheckResult> {
  const allViolations: StyleViolation[] = [];
  for (const f of files) {
    const result = verifyStyleConformity(f.content, f.path, fingerprint);
    allViolations.push(...result.violations);
  }
  const errors = allViolations.filter(v => v.severity === 'error');
  return {
    pass: errors.length === 0,
    violations: allViolations,
    summary: `检查 ${files.length} 文件: ${errors.length} 错误, ${allViolations.length - errors.length} 警告`,
  };
}
