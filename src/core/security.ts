// Security Layer — execution modes, sensitive file protection, dangerous command interception
import * as path from 'path';
import { ensureDir, fileExists, readFile } from '../utils/fs.js';
import type { GateCheck, ICloserConfig, SecurityIssue, SecurityRuleDefinition, Task } from '../types.js';

export type ExecutionMode = 'preview' | 'execute' | 'privileged';

export interface SecurityCheck {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

export const SECURITY_RULE_DEFINITIONS: SecurityRuleDefinition[] = [
  { ruleId: 'secret-openai-key', category: 'secret', severity: 'high', name: 'OpenAI API Key', description: '检测疑似 OpenAI API Key 硬编码', enabledByDefault: true },
  { ruleId: 'secret-aws-access-key', category: 'secret', severity: 'high', name: 'AWS Access Key', description: '检测疑似 AWS Access Key 硬编码', enabledByDefault: true },
  { ruleId: 'secret-private-key', category: 'secret', severity: 'high', name: 'Private Key', description: '检测私钥内容被写入代码或配置', enabledByDefault: true },
  { ruleId: 'secret-hardcoded-credential', category: 'secret', severity: 'medium', name: 'Hardcoded credential', description: '检测 password/token/apiKey 等疑似硬编码凭证', enabledByDefault: true },
  { ruleId: 'danger-rm-rf-root', category: 'dangerous-command', severity: 'high', name: 'rm -rf root', description: '检测删除根目录或通配目标的危险命令', enabledByDefault: true },
  { ruleId: 'danger-git-push-force', category: 'dangerous-command', severity: 'high', name: 'git push --force', description: '检测强推命令文本', enabledByDefault: true },
  { ruleId: 'danger-chmod-777', category: 'dangerous-command', severity: 'high', name: 'chmod 777', description: '检测过宽权限设置', enabledByDefault: true },
  { ruleId: 'danger-drop-database-object', category: 'dangerous-command', severity: 'high', name: 'DROP TABLE/DATABASE', description: '检测删除数据库对象的危险 SQL 命令文本', enabledByDefault: true },
  { ruleId: 'sql-string-concat', category: 'sql-injection', severity: 'high', name: 'SQL string concatenation', description: '检测 SQL 字符串拼接用户变量', enabledByDefault: true },
  { ruleId: 'sql-template-interpolation', category: 'sql-injection', severity: 'high', name: 'SQL template interpolation', description: '检测 SQL 模板字符串插值', enabledByDefault: true },
  { ruleId: 'sql-query-concat', category: 'sql-injection', severity: 'high', name: 'query() concatenation', description: '检测 query() 调用中的字符串拼接', enabledByDefault: true },
  { ruleId: 'sensitive-file-modified', category: 'sensitive-file', severity: 'high', name: 'Sensitive file modified', description: '检测敏感文件被修改', enabledByDefault: true },
  { ruleId: 'path-traversal-change', category: 'sensitive-file', severity: 'high', name: 'Path traversal change', description: '检测变更路径逃逸项目根目录', enabledByDefault: true },
];

export function getSecurityRuleDefinitions(): SecurityRuleDefinition[] {
  return [...SECURITY_RULE_DEFINITIONS];
}

export function getSecurityRuleDefinition(ruleId: string): SecurityRuleDefinition | undefined {
  return SECURITY_RULE_DEFINITIONS.find(rule => rule.ruleId === ruleId);
}

function requireSecurityRule(ruleId: string): SecurityRuleDefinition {
  const rule = getSecurityRuleDefinition(ruleId);
  if (!rule) throw new Error(`Unknown security rule: ${ruleId}`);
  return rule;
}

// ============================================================
// File modification checks
// ============================================================
export function checkFileModification(
  filePath: string,
  config: ICloserConfig,
  mode: ExecutionMode
): SecurityCheck {
  // Preview mode: never allow writes
  if (mode === 'preview') {
    return {
      allowed: false,
      reason: `预览模式下不允许修改文件。切换到执行模式以允许修改：ic config mode execute`,
    };
  }

  // Sensitive files: never allow (any mode)
  if (isSensitiveFile(filePath, config.security.sensitiveFiles)) {
    return {
      allowed: false,
      reason: `文件 "${filePath}" 匹配敏感文件保护规则，禁止修改`,
    };
  }

  // Config/CI files: only in privileged mode
  if (isConfigFile(filePath)) {
    if (mode !== 'privileged') {
      return {
        allowed: false,
        reason: `配置文件 "${filePath}" 需要在特权模式下才能修改`,
      };
    }
    return {
      allowed: true,
      requiresConfirmation: true,
    };
  }

  // Source files: allowed in execute or privileged mode
  if (mode === 'execute' || mode === 'privileged') {
    return { allowed: true };
  }

  return { allowed: false, reason: '未知执行模式' };
}

export function checkCommandExecution(
  command: string,
  config: ICloserConfig,
  mode: ExecutionMode
): SecurityCheck {
  // Preview mode: never allow commands
  if (mode === 'preview') {
    return {
      allowed: false,
      reason: '预览模式下不允许执行命令',
    };
  }

  // Dangerous commands: always require confirmation
  if (isDangerousCommand(command, config.security.dangerousCommands)) {
    return {
      allowed: true,
      requiresConfirmation: true,
    };
  }

  // Build/test commands: allowed in execute or privileged
  if (isBuildCommand(command)) {
    return { allowed: true };
  }

  // Git commands
  if (command.startsWith('git ')) {
    if (command.includes('push') && !config.security.allowGitPush) {
      return {
        allowed: false,
        reason: 'Git push 不允许，除非在配置中启用 allowGitPush',
      };
    }
    return { allowed: true };
  }

  // Other commands: privileged only
  if (mode !== 'privileged') {
    return {
      allowed: false,
      reason: `执行 "${command}" 需要特权模式`,
    };
  }

  return { allowed: true };
}

// ============================================================
// Sensitive file detection
// ============================================================
function isSensitiveFile(filePath: string, patterns: string[]): boolean {
  const basename = path.basename(filePath);
  const relative = filePath.replace(/\\/g, '/');

  for (const pattern of patterns) {
    if (matchWildcard(basename, pattern)) return true;
    if (matchWildcard(relative, pattern)) return true;
    // Simple contains check
    if (!pattern.includes('*') && basename.includes(pattern)) return true;
  }

  return false;
}

function matchWildcard(str: string, pattern: string): boolean {
  // Simple wildcard matching (* matches anything)
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    'i'
  );
  return regex.test(str);
}

function isConfigFile(filePath: string): boolean {
  const extPatterns = ['.yml', '.yaml', '.json', '.toml', '.ini', '.cfg'];
  const namePatterns = ['docker-compose', 'dockerfile', 'makefile',
    '.github/', '.gitlab-ci', 'jenkinsfile',
    'webpack', 'vite.config', 'rollup.config', 'tsconfig',
    'eslint', 'prettier', '.babelrc'];

  const relative = filePath.toLowerCase();
  const name = relative.replace(/^.*[/\\]/, '');
  if (extPatterns.some(ext => name.endsWith(ext))) return true;
  return namePatterns.some(p => relative.includes(p));
}

// ============================================================
// Dangerous command detection
// ============================================================
function isDangerousCommand(command: string, dangerousPatterns: string[]): boolean {
  const lower = command.toLowerCase();

  for (const pattern of dangerousPatterns) {
    if (lower.includes(pattern.toLowerCase())) return true;
  }

  // Additional heuristics
  if (/\brm\s+.*(-r\b.*-f\b|-f\b.*-r\b)/.test(lower)) return true; // rm with both -r and -f (any order)
  if (/\bgit\s+push\s+.*--force/.test(lower)) return true;
  if (/\bDROP\b/.test(command) && /\bTABLE\b|\bDATABASE\b/.test(command)) return true;
  if (/\bchmod\s+777\b/.test(lower)) return true;
  if (lower.includes('/dev/sda') || lower.includes('/dev/null > /')) return true;

  return false;
}

function isBuildCommand(command: string): boolean {
  const buildCommands = [
    'npm ', 'yarn ', 'pnpm ', 'npx ',
    'go ', 'cargo ', 'rustc ',
    'pip ', 'python ', 'poetry ',
    'javac ', 'mvn ', 'gradle ',
    'make ', 'cmake ',
    'node ', 'tsx ', 'ts-node ',
    'docker ', 'docker-compose ',
  ];

  const lower = command.toLowerCase();
  return buildCommands.some(c => lower.startsWith(c));
}

// ============================================================
// Audit logging
// ============================================================
export interface AuditEntry {
  timestamp: string;
  mode: ExecutionMode;
  action: string;
  target: string;
  allowed: boolean;
  reason?: string;
  taskId?: string;
}

export async function logAudit(
  rootPath: string,
  entry: AuditEntry
): Promise<void> {
  const auditPath = path.join(rootPath, '.icloser', 'audit.log');
  const line = JSON.stringify(entry);
  await ensureDir(path.dirname(auditPath));
  const fsp = await import('fs/promises');
  await fsp.appendFile(auditPath, line + '\n', 'utf-8');
}

// ============================================================
// Permission helper
// ============================================================
export function getEffectiveMode(
  task: Task,
  config: ICloserConfig
): ExecutionMode {
  // Use config default or explicit task settings
  return config.execution.defaultMode === 'execute' ? 'execute' : 'preview';
}

export function modeDescription(mode: ExecutionMode): string {
  switch (mode) {
    case 'preview': return '预览模式 — 只分析，不修改文件';
    case 'execute': return '执行模式 — 可修改源码文件，执行构建和测试';
    case 'privileged': return '特权模式 — 可修改配置，执行任意命令（需确认）';
  }
}

export function validateGitPush(
  command: string,
  config: ICloserConfig
): SecurityCheck {
  if (command.includes('git push') && !config.security.allowGitPush) {
    return {
      allowed: false,
      reason: 'Git push 已禁用。如需启用：ic config allowGitPush true',
    };
  }
  return { allowed: true };
}

// ============================================================
// Changed file security scan
// ============================================================
export async function scanTaskSecurity(
  rootPath: string,
  task: Task,
  config: ICloserConfig
): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];
  const seen = new Set<string>();
  const disabledRules = new Set(config.security.disabledRules || []);

  for (const change of task.changes) {
    const normalized = change.file.replace(/\\/g, '/');
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (isSensitiveFile(normalized, config.security.sensitiveFiles)) {
      const rule = requireSecurityRule('sensitive-file-modified');
      issues.push({
        file: normalized,
        severity: rule.severity,
        category: rule.category,
        ruleId: rule.ruleId,
        message: '敏感文件被修改',
      });
    }

    const rootResolved = path.resolve(rootPath);
    const fullPath = path.resolve(rootResolved, normalized);
    const relativeFromRoot = path.relative(rootResolved, fullPath);
    if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
      const rule = requireSecurityRule('path-traversal-change');
      issues.push({
        file: normalized,
        severity: rule.severity,
        category: rule.category,
        ruleId: rule.ruleId,
        message: '变更路径逃逸项目根目录',
      });
      continue;
    }

    if (!(await fileExists(fullPath))) continue;

    const content = await readFile(fullPath);
    issues.push(...scanContentSecurity(normalized, content));
  }

  return issues.filter(issue => !disabledRules.has(issue.ruleId));
}

export function getSecurityIssuesFromGateCheck(check: GateCheck): SecurityIssue[] {
  if (check.category !== 'security') return [];
  const issues = check.metadata?.issues;
  return Array.isArray(issues) ? issues : [];
}

function scanContentSecurity(file: string, content: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(line)) {
        const rule = requireSecurityRule(pattern.ruleId);
        issues.push({
          file,
          severity: rule.severity,
          category: rule.category,
          ruleId: rule.ruleId,
          line: lineNo,
          evidence: sanitizeEvidence(line, 'secret'),
          message: `疑似硬编码密钥 (${pattern.name})`,
        });
      }
    }

    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (isDangerousCommandConfigContext(lines, index)) continue;
      if (pattern.regex.test(line)) {
        const rule = requireSecurityRule(pattern.ruleId);
        issues.push({
          file,
          severity: rule.severity,
          category: rule.category,
          ruleId: rule.ruleId,
          line: lineNo,
          evidence: sanitizeEvidence(line, 'dangerous-command'),
          message: '疑似危险命令',
        });
      }
    }

    for (const pattern of SQL_INJECTION_PATTERNS) {
      if (pattern.regex.test(line)) {
        const rule = requireSecurityRule(pattern.ruleId);
        issues.push({
          file,
          severity: rule.severity,
          category: rule.category,
          ruleId: rule.ruleId,
          line: lineNo,
          evidence: sanitizeEvidence(line, 'sql-injection'),
          message: '疑似 SQL 拼接风险',
        });
      }
    }
  });

  return issues;
}

function isDangerousCommandConfigContext(lines: string[], index: number): boolean {
  let bracketDepth = 0;

  for (let i = index; i >= 0; i--) {
    const line = lines[i];
    if (i !== index && /^\s*(?:[\]},]|};?)/.test(line) && bracketDepth <= 0) return false;
    if (/\bdangerousCommands\b\s*[:=]\s*\[/.test(line) || /["']dangerousCommands["']\s*:\s*\[/.test(line)) return true;

    bracketDepth += (line.match(/\]/g) || []).length;
    bracketDepth -= (line.match(/\[/g) || []).length;
  }

  return false;
}

function sanitizeEvidence(line: string, category: SecurityIssue['category']): string {
  const compact = line.trim().replace(/\s+/g, ' ');
  const shortened = compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
  if (category !== 'secret') return shortened;
  return shortened
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
    .replace(/\bAKIA[0-9A-Z]{8,}\b/g, 'AKIA***')
    .replace(/(['"])[^'"]{8,}\1/g, '$1***$1');
}

const SECRET_PATTERNS: Array<{ ruleId: string; name: string; regex: RegExp }> = [
  { ruleId: 'secret-openai-key', name: 'OpenAI API Key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { ruleId: 'secret-aws-access-key', name: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { ruleId: 'secret-private-key', name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { ruleId: 'secret-hardcoded-credential', name: 'Hardcoded credential', regex: /\b(password|passwd|pwd|secret|api[_-]?key|token)\b\s*[:=]\s*['"][^'"]{8,}['"]/i },
];

const DANGEROUS_COMMAND_PATTERNS = [
  { ruleId: 'danger-rm-rf-root', regex: /\brm\s+-rf\s+(?:\/|\*)/i },
  { ruleId: 'danger-git-push-force', regex: /\bgit\s+push\b.*--force/i },
  { ruleId: 'danger-chmod-777', regex: /\bchmod\s+777\b/i },
  { ruleId: 'danger-drop-database-object', regex: /\bdrop\s+(table|database)\b/i },
];

const SQL_INJECTION_PATTERNS = [
  { ruleId: 'sql-string-concat', regex: /\b(select|insert|update|delete)\b.+\+\s*[A-Za-z_$]/i },
  { ruleId: 'sql-template-interpolation', regex: /`[^`]*\b(select|insert|update|delete)\b[^`]*\$\{[^}]+}/i },
  { ruleId: 'sql-query-concat', regex: /\bquery\s*\([^)]*\+\s*[A-Za-z_$]/i },
];
