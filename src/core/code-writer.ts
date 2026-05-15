// Code Writer — AI-powered code generation, completion, and refactoring
import type { ProjectIndex, StyleFingerprint } from '../types.js';

// ============================================================
// C1: Context-aware code generation
// ============================================================
export async function readCodePatterns(
  rootPath: string,
  index: ProjectIndex,
  targetModule?: string,
): Promise<string> {
  const parts: string[] = [];
  const { readFile } = await import('../utils/fs.js');

  // Read 3-5 existing source files for pattern learning
  const sourceFiles = index.modules
    .flatMap(m => m.files.filter(f => !/test|spec/i.test(f)).slice(0, 3))
    .slice(0, 5);

  for (const file of sourceFiles) {
    try {
      const content = await readFile([rootPath, file].join('/').replace(/\/+/g, '/'));
      if (content.length < 5000) {
        parts.push(`// ${file}\n${content}`);
      } else {
        parts.push(`// ${file} (前5000字符)\n${content.slice(0, 5000)}`);
      }
    } catch {}
  }

  return parts.join('\n\n');
}

// C3: Extract style fingerprint as AI prompt constraint
export function buildStyleConstraints(fingerprint: StyleFingerprint): string {
  const rules: string[] = [];
  rules.push(`命名: ${fingerprint.namingConvention}`);
  rules.push(`缩进: ${fingerprint.indentStyle === 'spaces' ? `${fingerprint.indentSize}空格` : 'Tab'}`);
  rules.push(`引号: ${fingerprint.quoteStyle === 'single' ? '单引号' : '双引号'}`);
  rules.push(`分号: ${fingerprint.semicolons ? '必须有' : '不能有'}`);
  rules.push(`错误处理: ${fingerprint.errorHandling}`);
  return `严格遵守以下代码风格:\n${rules.map(r => `- ${r}`).join('\n')}`;
}

// C6: Parse error output for targeted fixes
export function parseErrorOutput(errorText: string): { file: string; line: number; message: string }[] {
  const errors: { file: string; line: number; message: string }[] = [];
  const patterns = [
    /(\S+\.\w+):(\d+):\d+\s*[-–]\s*error\s+(.+)/gi,
    /(\S+\.\w+):(\d+):\s*(.+)/gi,
    /at\s+(\S+\.\w+):(\d+)/gi,
  ];
  for (const pattern of patterns) {
    for (const m of errorText.matchAll(pattern)) {
      errors.push({ file: m[1], line: parseInt(m[2]), message: (m[3] || '').slice(0, 100) });
    }
  }
  return errors.slice(0, 20);
}

// C2: Find incomplete functions in a file
export function findIncompleteCode(content: string): { line: number; signature: string; indicator: string }[] {
  const incomplete: { line: number; signature: string; indicator: string }[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\/\/\s*TODO|FIXME|Not implemented|throw new Error\(['"]Not implemented['"]\)/.test(line)) {
      incomplete.push({ line: i + 1, signature: line.trim().slice(0, 100), indicator: 'TODO/未实现' });
    } else if (/^\s*(function|async function|def|func|pub fn)\s+\w+\s*\([^)]*\)\s*\{\s*\}$/.test(line.trim())) {
      incomplete.push({ line: i + 1, signature: line.trim().slice(0, 100), indicator: '空函数体' });
    }
  }
  return incomplete;
}

// C4: Generate test file path from source file path
export function getTestFilePath(sourcePath: string, index: ProjectIndex): string {
  const ext = sourcePath.split('.').pop() || 'ts';
  const base = sourcePath.replace(/\.[^.]+$/, '');
  const testPatterns = [
    `${base}.test.${ext}`,
    `${base}.spec.${ext}`,
    `tests/${base}.test.${ext}`,
    `__tests__/${base}.test.${ext}`,
  ];
  // Check existing test files
  for (const tp of testPatterns) {
    if (index.modules.some(m => m.files.some(f => f.replace(/\\/g, '/').includes(tp.replace(/\\/g, '/'))))) {
      return tp;
    }
  }
  return testPatterns[0];
}

// C5: Find all files referencing a symbol
export function findSymbolReferences(index: ProjectIndex, symbol: string): string[] {
  const refs: string[] = [];
  for (const mod of index.modules) {
    for (const exp of mod.exports) {
      if (exp.name.toLowerCase().includes(symbol.toLowerCase())) {
        refs.push(`${mod.name}/${exp.name}`);
      }
    }
    for (const imp of mod.imports) {
      if (imp.symbols.some(s => s.toLowerCase().includes(symbol.toLowerCase()))) {
        refs.push(`${mod.name} (imports ${symbol})`);
      }
    }
  }
  return [...new Set(refs)].slice(0, 20);
}

// C4: Generate test file alongside source code
export async function generateWithTests(
  desc: string, rootPath: string, index: ProjectIndex,
  provider: any,
): Promise<{ source: { file: string; content: string }[]; tests: { file: string; content: string }[] }> {
  const styleConstraint = index.styleFingerprint ? buildStyleConstraints(index.styleFingerprint) : '';
  const codePatterns = await readCodePatterns(rootPath, index);

  // Step 1: Generate source code
  const sourceResp = await provider.chat({
    systemPrompt: '你是代码生成专家。只输出JSON变更契约。' + (styleConstraint ? '\n' + styleConstraint : ''),
    task: desc + (codePatterns ? '\n\n现有代码模式:\n' + codePatterns.slice(0, 2000) : ''),
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
  });

  let sources: { file: string; content: string }[] = [];
  try {
    const j = JSON.parse((sourceResp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
    sources = (j.changes || []).map((c: { file: string; content: string }) => ({ file: c.file, content: c.content }));
  } catch {}

  // Step 2: Generate tests for source files
  const testResp = await provider.chat({
    systemPrompt: '你是测试专家。为下列源码生成单元测试。只输出JSON变更契约。测试文件路径遵循项目约定。',
    task: '为以下源码生成测试:\n' + sources.map(s => `## ${s.file}\n${s.content.slice(0, 1000)}`).join('\n\n'),
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
  });

  let tests: { file: string; content: string }[] = [];
  try {
    const j = JSON.parse((testResp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
    tests = (j.changes || []).map((c: { file: string; content: string }) => ({ file: c.file, content: c.content }));
  } catch {}

  return { source: sources, tests };
}

// C9: Generate scaffolding for common patterns
export function generateScaffold(
  type: 'crud' | 'middleware' | 'route' | 'component',
  name: string,
  language: string,
): { files: { path: string; content: string }[] } {
  const PascalName = name.charAt(0).toUpperCase() + name.slice(1);
  const camelName = name.charAt(0).toLowerCase() + name.slice(1);
  const files: { path: string; content: string }[] = [];

  if (language === 'typescript' || language === 'javascript') {
    const ext = language === 'typescript' ? 'ts' : 'js';
    switch (type) {
      case 'crud':
        files.push({ path: `${camelName}.model.${ext}`, content: `export interface ${PascalName} {\n  id: string;\n  createdAt: Date;\n  updatedAt: Date;\n}\n` });
        files.push({ path: `${camelName}.controller.${ext}`, content: `import { ${PascalName} } from './${camelName}.model';\n\nexport async function get${PascalName}s() {\n  // TODO: implement\n}\n\nexport async function create${PascalName}(data: Partial<${PascalName}>) {\n  // TODO: implement\n}\n` });
        files.push({ path: `${camelName}.route.${ext}`, content: `import { Router } from 'express';\nimport { get${PascalName}s, create${PascalName} } from './${camelName}.controller';\n\nconst router = Router();\nrouter.get('/', get${PascalName}s);\nrouter.post('/', create${PascalName});\n\nexport default router;\n` });
        break;
      case 'middleware':
        files.push({ path: `${camelName}.middleware.${ext}`, content: `import { Request, Response, NextFunction } from 'express';\n\nexport function ${camelName}Middleware(req: Request, res: Response, next: NextFunction) {\n  // TODO: implement middleware logic\n  next();\n}\n` });
        break;
      case 'route':
        files.push({ path: `${camelName}.route.${ext}`, content: `import { Router } from 'express';\n\nconst router = Router();\n\nrouter.get('/', (req, res) => { res.json({ message: '${name}' }); });\n\nexport default router;\n` });
        break;
      case 'component':
        files.push({ path: `${PascalName}.tsx`, content: `import React from 'react';\n\ninterface ${PascalName}Props {}\n\nexport const ${PascalName}: React.FC<${PascalName}Props> = () => {\n  return <div>${name}</div>;\n};\n` });
        break;
    }
  }
  return { files };
}
