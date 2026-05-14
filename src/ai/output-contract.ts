export type AIFileOperation = 'write';

export interface AIFileChange {
  file: string;
  operation: AIFileOperation;
  content: string;
  reasoning: string;
}

export interface AIOutputContract {
  summary: string;
  changes: AIFileChange[];
}

export class AIOutputContractError extends Error {
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(message);
    this.name = 'AIOutputContractError';
    this.detail = detail;
  }
}

export function createAIOutputContract(summary: string, changes: AIFileChange[]): AIOutputContract {
  return validateAIOutputContract({ summary, changes });
}

export function formatAIOutputContract(output: AIOutputContract): string {
  return [
    '```json',
    JSON.stringify(validateAIOutputContract(output), null, 2),
    '```',
  ].join('\n');
}

export function parseAIOutput(content: string): AIOutputContract {
  const jsonOutput = parseJsonContract(content);
  if (jsonOutput) return validateAIOutputContract(jsonOutput);

  const legacyChanges = parseLegacyWriteBlocks(content);
  if (legacyChanges.length > 0) {
    return validateAIOutputContract({
      summary: 'legacy write blocks',
      changes: legacyChanges,
    });
  }

  throw new AIOutputContractError(
    'AI 未返回可执行的文件变更',
    '请让模型输出 JSON：{ "summary": "...", "changes": [{ "file": "相对路径", "operation": "write", "content": "...", "reasoning": "..." }] }',
  );
}

export function validateAIOutputContract(value: unknown): AIOutputContract {
  if (!isRecord(value)) {
    throw new AIOutputContractError('AI 输出不是对象');
  }

  const summary = typeof value.summary === 'string' ? value.summary : '';
  const rawChanges = Array.isArray(value.changes) ? value.changes : null;
  if (!rawChanges) {
    throw new AIOutputContractError('AI 输出缺少 changes 数组');
  }
  if (rawChanges.length === 0) {
    throw new AIOutputContractError('AI 输出 changes 为空');
  }

  const changes = rawChanges.map((raw, index): AIFileChange => {
    if (!isRecord(raw)) {
      throw new AIOutputContractError(`changes[${index}] 不是对象`);
    }

    const file = typeof raw.file === 'string' ? normalizeFilePath(raw.file) : '';
    const operation = raw.operation === 'write' ? raw.operation : null;
    const content = typeof raw.content === 'string' ? raw.content : '';
    const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : '';

    if (!file) throw new AIOutputContractError(`changes[${index}] 缺少 file`);
    if (!operation) throw new AIOutputContractError(`changes[${index}] operation 仅支持 write`);
    if (content.length === 0) throw new AIOutputContractError(`changes[${index}] content 为空`);
    if (!reasoning.trim()) throw new AIOutputContractError(`changes[${index}] 缺少 reasoning`);
    assertSafeRelativePath(file, index);

    return { file, operation, content, reasoning };
  });

  return {
    summary: summary || 'AI file changes',
    changes,
  };
}

function parseJsonContract(content: string): unknown | null {
  const fenced = /```(?:json|icloser-ai-output)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenced.exec(content)) !== null) {
    const parsed = tryParseJson(match[1]);
    if (parsed && isRecord(parsed) && Array.isArray(parsed.changes)) return parsed;
  }

  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const parsed = tryParseJson(trimmed);
    if (parsed && isRecord(parsed) && Array.isArray(parsed.changes)) return parsed;
  }

  for (const candidate of findJsonObjectCandidates(content)) {
    const parsed = tryParseJson(candidate);
    if (parsed && isRecord(parsed) && Array.isArray(parsed.changes)) return parsed;
  }

  return null;
}

function findJsonObjectCandidates(content: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(content.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function parseLegacyWriteBlocks(content: string): AIFileChange[] {
  const blocks: AIFileChange[] = [];
  const regex = /```write:(\S+)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      file: match[1].trim(),
      operation: 'write',
      content: match[2],
      reasoning: 'legacy write block',
    });
  }
  return blocks;
}

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeFilePath(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function assertSafeRelativePath(file: string, index: number): void {
  if (/^[A-Za-z]:\//.test(file) || file.startsWith('/')) {
    throw new AIOutputContractError(`changes[${index}] file 必须是相对路径`);
  }
  const parts = file.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some(part => part === '..')) {
    throw new AIOutputContractError(`changes[${index}] file 不能越界`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
