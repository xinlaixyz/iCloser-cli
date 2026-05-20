// Code Writer — AI-powered code generation, completion, and refactoring
import type { ProjectIndex, StyleFingerprint } from '../types.js';
import type { AIProviderAdapter } from '../ai/provider.js';

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
    } catch { /* best-effort */ }
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
  const name = base.replace(/^.*[/\\]/, ''); // just the filename, no path
  const dir = base.replace(/[/\\][^/\\]*$/, ''); // the directory part
  const testPatterns = [
    `${base}.test.${ext}`,
    `${base}.spec.${ext}`,
    `tests/${name}.test.${ext}`,
    dir ? `${dir}/__tests__/${name}.test.${ext}` : `__tests__/${name}.test.${ext}`,
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
  provider: AIProviderAdapter,
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
  } catch { return { source: [], tests: [] }; }

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
  } catch { return { source: sources, tests: [] }; }

  return { source: sources, tests };
}

// C7: Generate with auto verify-repair loop (max 3 rounds)
export async function generateWithVerifyLoop(
  desc: string, rootPath: string, index: ProjectIndex,
  provider: AIProviderAdapter,
): Promise<{
  source: { file: string; content: string }[];
  tests: { file: string; content: string }[];
  verifyRounds: number;
  verifyPassed: boolean;
  diagnostics: string;
}> {
  const MAX_ROUNDS = 3;
  let result = await generateWithTests(desc, rootPath, index, provider);
  if (result.source.length === 0) {
    return { ...result, verifyRounds: 0, verifyPassed: false, diagnostics: 'AI 未生成任何代码，无法验证。' };
  }

  const { writeFile, ensureDir } = await import('../utils/fs.js');
  const path = await import('path');

  // Write generated files to disk for verification
  try {
    const resolveGeneratedPath = (file: string): string => {
      const fullPath = path.resolve(rootPath, file);
      const rel = path.relative(rootPath, fullPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`生成文件路径越界: ${file}`);
      }
      return fullPath;
    };

    for (const s of result.source) {
      const fullPath = resolveGeneratedPath(s.file);
      await ensureDir(path.dirname(fullPath));
      await writeFile(fullPath, s.content);
    }
    for (const t of result.tests) {
      const fullPath = resolveGeneratedPath(t.file);
      await ensureDir(path.dirname(fullPath));
      await writeFile(fullPath, t.content);
    }
  } catch (e) {
    return { ...result, verifyRounds: 0, verifyPassed: false, diagnostics: `写入生成文件失败: ${(e as Error).message}` };
  }

  // Verify loop
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    try {
      const { runVerification } = await import('./verifier.js');
      const verifyResult = await runVerification(rootPath, index.identity, {
        id: `verify-${Date.now().toString(36)}`,
        description: desc,
        status: 'queued',
        priority: 'normal',
        createdAt: new Date().toISOString(),
        changes: [],
        diffs: [],
        reasoning: [],
        errorLog: [],
        retryCount: 0,
        maxRetries: 3,
        agentExecutions: [],
      } as any, {
        stages: ['compile' as any, 'lint' as any],
        maxRetries: 1,
        timeout: 60000,
      } as any);

      if (verifyResult.overall === 'pass') {
        return { ...result, verifyRounds: round, verifyPassed: true, diagnostics: '' };
      }

      // Parse errors and feed back to AI for fix
      const errorText = verifyResult.stages
        .filter((s: any) => s.status !== 'pass')
        .map((s: any) => s.errorSummary || `${s.stage}: failed`)
        .join('\n');

      if (round < MAX_ROUNDS) {
        const errors = parseErrorOutput(errorText);
        if (errors.length === 0) break; // can't parse errors, can't auto-fix

        // AI fix pass
        const fixResp = await provider.chat({
          systemPrompt: '你是代码修复专家。根据编译/lint错误修复代码。只输出JSON变更契约。只修改报错文件，仅改错误行。',
          task: `修复以下错误:\n${errors.map(e => `${e.file}:${e.line}: ${e.message}`).join('\n')}\n\n现有代码:\n${result.source.map(s => `## ${s.file}\n${s.content}`).join('\n\n')}`,
          context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
        });

        try {
          const j = JSON.parse((fixResp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
          const fixes = (j.changes || []) as { file: string; content: string }[];
          // Apply fixes to source array
          for (const fix of fixes) {
            const srcIdx = result.source.findIndex(s => s.file === fix.file);
            if (srcIdx >= 0) {
              result.source[srcIdx].content = fix.content;
            } else {
              const testIdx = result.tests?.findIndex(t => t.file === fix.file) ?? -1;
              if (testIdx >= 0 && result.tests) result.tests[testIdx].content = fix.content;
            }
            const fullPath = path.resolve(rootPath, fix.file);
            const rel = path.relative(rootPath, fullPath);
            if (rel.startsWith('..') || path.isAbsolute(rel)) {
              throw new Error(`生成文件路径越界: ${fix.file}`);
            }
            await writeFile(fullPath, fix.content);
          }
        } catch { break; } // can't parse fix response, stop trying
      } else {
        return {
          ...result,
          verifyRounds: round,
          verifyPassed: false,
          diagnostics: `验证失败 (${round} 轮后):\n${errorText}`,
        };
      }
    } catch (e) {
      return { ...result, verifyRounds: round, verifyPassed: false, diagnostics: `验证异常: ${(e as Error).message}` };
    }
  }

  return {
    ...result,
    verifyRounds: MAX_ROUNDS,
    verifyPassed: false,
    diagnostics: `达到最大修复轮数 (${MAX_ROUNDS})，请手动检查。`,
  };
}

// C9: Generate scaffolding for common patterns, style-aware
export function generateScaffold(
  type: 'crud' | 'middleware' | 'route' | 'component',
  name: string,
  language: string,
  style?: StyleFingerprint,
): { files: { path: string; content: string }[] } {
  const PascalName = name.charAt(0).toUpperCase() + name.slice(1);
  const camelName = name.charAt(0).toLowerCase() + name.slice(1);
  const files: { path: string; content: string }[] = [];

  const quote = style?.quoteStyle === 'single' ? "'" : '"';
  const semi = style?.semicolons === false ? '' : ';';

  if (language === 'typescript' || language === 'javascript') {
    const ext = language === 'typescript' ? 'ts' : 'js';
    switch (type) {
      case 'crud':
        files.push({ path: `${camelName}.model.${ext}`, content: `export interface ${PascalName} {\n  id: string${semi}\n  createdAt: Date${semi}\n  updatedAt: Date${semi}\n}\n` });
        files.push({ path: `${camelName}.controller.${ext}`, content: `import { ${PascalName} } from ${quote}./${camelName}.model${quote}${semi}\n\nexport async function get${PascalName}s() {\n  // TODO: implement\n}\n\nexport async function create${PascalName}(data: Partial<${PascalName}>) {\n  // TODO: implement\n}\n` });
        files.push({ path: `${camelName}.route.${ext}`, content: `import { Router } from ${quote}express${quote}${semi}\nimport { get${PascalName}s, create${PascalName} } from ${quote}./${camelName}.controller${quote}${semi}\n\nconst router = Router()${semi}\nrouter.get(${quote}/${quote}, get${PascalName}s)${semi}\nrouter.post(${quote}/${quote}, create${PascalName})${semi}\n\nexport default router${semi}\n` });
        break;
      case 'middleware':
        files.push({ path: `${camelName}.middleware.${ext}`, content: `import { Request, Response, NextFunction } from ${quote}express${quote}${semi}\n\nexport function ${camelName}Middleware(req: Request, res: Response, next: NextFunction) {\n  // TODO: implement middleware logic\n  next()${semi}\n}\n` });
        break;
      case 'route':
        files.push({ path: `${camelName}.route.${ext}`, content: `import { Router } from ${quote}express${quote}${semi}\n\nconst router = Router()${semi}\n\nrouter.get(${quote}/${quote}, (req, res) => { res.json({ message: ${quote}${name}${quote} }) })${semi}\n\nexport default router${semi}\n` });
        break;
      case 'component':
        files.push({ path: `${PascalName}.tsx`, content: `import React from ${quote}react${quote}${semi}\n\ninterface ${PascalName}Props {}\n\nexport const ${PascalName}: React.FC<${PascalName}Props> = () => {\n  return <div>${name}</div>${semi}\n}${semi}\n` });
        break;
    }
  }

  if (language === 'go') {
    const pkg = camelName;
    switch (type) {
      case 'crud':
        files.push({ path: `${camelName}/model.go`, content: `package ${pkg}\n\ntype ${PascalName} struct {\n\tID        string \`json:"id"\`\n\tCreatedAt string \`json:"createdAt"\`\n\tUpdatedAt string \`json:"updatedAt"\`\n}\n` });
        files.push({ path: `${camelName}/handler.go`, content: `package ${pkg}\n\nimport (\n\t"encoding/json"\n\t"net/http"\n)\n\nfunc Get${PascalName}s(w http.ResponseWriter, r *http.Request) {\n\t// TODO: implement\n\tjson.NewEncoder(w).Encode([]${PascalName}{})\n}\n\nfunc Create${PascalName}(w http.ResponseWriter, r *http.Request) {\n\t// TODO: implement\n\tw.WriteHeader(http.StatusCreated)\n}\n` });
        files.push({ path: `${camelName}/router.go`, content: `package ${pkg}\n\nimport "net/http"\n\nfunc RegisterRoutes(mux *http.ServeMux) {\n\tmux.HandleFunc("/${camelName}", func(w http.ResponseWriter, r *http.Request) {\n\t\tswitch r.Method {\n\t\tcase http.MethodGet:\n\t\t\tGet${PascalName}s(w, r)\n\t\tcase http.MethodPost:\n\t\t\tCreate${PascalName}(w, r)\n\t\t}\n\t})\n}\n` });
        break;
      case 'middleware':
        files.push({ path: `${camelName}_middleware.go`, content: `package main\n\nimport "net/http"\n\nfunc ${PascalName}Middleware(next http.Handler) http.Handler {\n\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n\t\t// TODO: implement middleware logic\n\t\tnext.ServeHTTP(w, r)\n\t})\n}\n` });
        break;
      case 'route':
        files.push({ path: `${camelName}_handler.go`, content: `package main\n\nimport (\n\t"encoding/json"\n\t"net/http"\n)\n\nfunc ${PascalName}Handler(w http.ResponseWriter, r *http.Request) {\n\tjson.NewEncoder(w).Encode(map[string]string{"message": "${name}"})\n}\n` });
        break;
    }
  }

  if (language === 'python') {
    switch (type) {
      case 'crud':
        files.push({ path: `${camelName}/model.py`, content: `from dataclasses import dataclass\nfrom datetime import datetime\n\n@dataclass\nclass ${PascalName}:\n    id: str\n    created_at: datetime\n    updated_at: datetime\n` });
        files.push({ path: `${camelName}/handler.py`, content: `from fastapi import APIRouter\nfrom .model import ${PascalName}\n\nrouter = APIRouter()\n\n@router.get("/")\nasync def get_${camelName}s():\n    # TODO: implement\n    return []\n\n@router.post("/")\nasync def create_${camelName}(data: dict):\n    # TODO: implement\n    return {"status": "created"}\n` });
        break;
      case 'middleware':
        files.push({ path: `${camelName}_middleware.py`, content: `from starlette.middleware.base import BaseHTTPMiddleware\n\nclass ${PascalName}Middleware(BaseHTTPMiddleware):\n    async def dispatch(self, request, call_next):\n        # TODO: implement middleware logic\n        response = await call_next(request)\n        return response\n` });
        break;
      case 'route':
        files.push({ path: `${camelName}_router.py`, content: `from fastapi import APIRouter\n\nrouter = APIRouter()\n\n@router.get("/")\nasync def ${camelName}_root():\n    return {"message": "${name}"}\n` });
        break;
    }
  }

  if (language === 'java') {
    switch (type) {
      case 'crud':
        files.push({ path: `src/main/java/${camelName}/${PascalName}.java`, content: `package ${camelName};\n\npublic class ${PascalName} {\n    private String id;\n    private java.time.Instant createdAt;\n    private java.time.Instant updatedAt;\n\n    // TODO: add getters/setters\n}\n` });
        files.push({ path: `src/main/java/${camelName}/${PascalName}Controller.java`, content: `package ${camelName};\n\nimport org.springframework.web.bind.annotation.*;\nimport java.util.List;\n\n@RestController\n@RequestMapping("/${camelName}")\npublic class ${PascalName}Controller {\n\n    @GetMapping\n    public List<${PascalName}> getAll() {\n        // TODO: implement\n        return List.of();\n    }\n\n    @PostMapping\n    public ${PascalName} create(@RequestBody ${PascalName} data) {\n        // TODO: implement\n        return data;\n    }\n}\n` });
        break;
      case 'middleware':
        files.push({ path: `src/main/java/${camelName}/${PascalName}Filter.java`, content: `package ${camelName};\n\nimport jakarta.servlet.*;\nimport java.io.IOException;\n\npublic class ${PascalName}Filter implements Filter {\n    @Override\n    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)\n            throws IOException, ServletException {\n        // TODO: implement middleware logic\n        chain.doFilter(req, res);\n    }\n}\n` });
        break;
      case 'route':
        files.push({ path: `src/main/java/${camelName}/${PascalName}Controller.java`, content: `package ${camelName};\n\nimport org.springframework.web.bind.annotation.*;\nimport java.util.Map;\n\n@RestController\npublic class ${PascalName}Controller {\n    @GetMapping("/${camelName}")\n    public Map<String, String> index() {\n        return Map.of("message", "${name}");\n    }\n}\n` });
        break;
    }
  }

  return { files };
}

// C8-enhanced: Scaffold + AI auto-complete TODO stubs
export async function generateScaffoldWithAI(
  type: 'crud' | 'middleware' | 'route' | 'component',
  name: string,
  language: string,
  rootPath: string,
  index: ProjectIndex | null,
  provider: AIProviderAdapter,
  style?: StyleFingerprint,
): Promise<{ files: { path: string; content: string }[] }> {
  // Step 1: Generate scaffold skeleton
  const { files } = generateScaffold(type, name, language, style);

  // Step 2: Find files with TODO stubs and AI-complete them
  const todos = files.filter(f => /\/\/\s*TODO:?\s*implement/i.test(f.content));
  if (todos.length === 0 || !provider) return { files };

  try {
    // Read existing code patterns for context
    const codePatterns = index ? await readCodePatterns(rootPath, index) : '';
    const styleConstraint = style ? buildStyleConstraints(style) : '';

    for (const todo of todos) {
      const resp = await provider.chat({
        systemPrompt: [
          '你是代码补全专家。补全以下骨架代码中的 TODO 实现。',
          '规则:',
          '  1. 补全所有 TODO，保持与现有项目代码风格一致',
          '  2. 只输出该文件的 JSON 变更契约: { "content": "补全后的完整文件内容" }',
          '  3. 不要修改已有的接口/类型定义',
          styleConstraint,
        ].filter(Boolean).join('\n'),
        task: [
          `文件: ${todo.path}`,
          `骨架代码:\n\`\`\`\n${todo.content}\n\`\`\``,
          codePatterns ? `\n现有代码模式参考:\n${codePatterns.slice(0, 2000)}` : '',
        ].join('\n'),
        context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
        history: '',
      });

      try {
        const json = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
        if (json.content && json.content !== todo.content) {
          todo.content = json.content; // Replace TODO stub with AI-completed code
        }
      } catch { /* keep TODO stub if AI output unparseable */ }
    }
  } catch { /* keep TODO stubs if AI unavailable */ }

  return { files };
}

// C12: Cross-file refactoring — AI reads multiple files, refactors coherently
export async function refactorCrossFile(
  filePaths: string[],
  instruction: string,
  rootPath: string,
  index: ProjectIndex | null,
  provider: AIProviderAdapter,
): Promise<{ files: { path: string; original: string; refactored: string }[]; explanation: string }> {
  const { readFile } = await import('../utils/fs.js');
  const styleConstraint = index?.styleFingerprint ? buildStyleConstraints(index.styleFingerprint) : '';

  // Read all files
  const fileContents: Record<string, string> = {};
  for (const fp of filePaths) {
    try { fileContents[fp] = await readFile(fp); } catch { /* skip unreadable */ }
  }

  const filesBlock = Object.entries(fileContents)
    .map(([fp, content]) => `### ${fp}\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``)
    .join('\n\n');

  const resp = await provider.chat({
    systemPrompt: [
      '你是跨文件代码重构专家。基于指令对多个文件进行一致性重构。',
      '规则:',
      '  1. 保持公开 API 不变',
      '  2. 所有文件的修改必须一致（如重命名必须在所有文件中同步）',
      '  3. 输出 JSON: {"files": [{"path": "...", "content": "重构后完整内容"}], "explanation": "说明"}',
      styleConstraint,
    ].filter(Boolean).join('\n'),
    task: `重构指令: ${instruction}\n\n${filesBlock.slice(0, 12000)}`,
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    history: '',
  });

  const results: { path: string; original: string; refactored: string }[] = [];

  try {
    const json = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
    const changedFiles: { path: string; content: string }[] = json.files || [];

    for (const cf of changedFiles) {
      const original = fileContents[cf.path] || '';
      if (cf.content && cf.content !== original) {
        results.push({ path: cf.path, original, refactored: cf.content });
      }
    }

    return { files: results, explanation: json.explanation || '' };
  } catch {
    return { files: [], explanation: 'AI 输出解析失败' };
  }
}

export interface EnforcementResult {
  passed: boolean;
  changes: { file: string; content: string }[];
  fixes: number;
  diagnostics: string;
}

/**
 * Validate AI-generated changes by running compile/lint BEFORE writing.
 * If compilation fails, auto-fix with AI (max 2 rounds).
 * If style fingerprint is available, verify style consistency.
 */
export async function enforceCodeQuality(
  changes: { file: string; content: string }[],
  rootPath: string,
  identity: { language: string },
  provider: AIProviderAdapter,
  index?: { styleFingerprint?: import('../types.js').StyleFingerprint },
): Promise<EnforcementResult> {
  if (changes.length === 0) return { passed: true, changes: [], fixes: 0, diagnostics: '' };

  const MAX_FIX_ROUNDS = 2;
  let currentChanges = [...changes];
  let totalFixes = 0;
  const diagnostics: string[] = [];

  const { writeFile, ensureDir } = await import('../utils/fs.js');
  const path = await import('path');

  const allTempFiles: string[] = [];
  for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
    // Write changes to temp locations for validation
    const tempFiles: { original: string; temp: string; content: string }[] = [];
    for (const c of currentChanges) {
      const fullPath = [rootPath, c.file].join('/').replace(/\/+/g, '/');
      const tempPath = fullPath + '.gate-tmp';
      await ensureDir(path.dirname(tempPath));
      await writeFile(tempPath, c.content);
      tempFiles.push({ original: fullPath, temp: tempPath, content: c.content });
      allTempFiles.push(tempPath);
    }

    // Run compile check
    const compileResult = await runCompileCheck(tempFiles, rootPath, identity);

    if (compileResult.passed) {
      // Style check (best-effort, non-blocking)
      if (index?.styleFingerprint && round === 0) {
        const styleIssues = checkStyleConsistency(currentChanges, index.styleFingerprint);
        if (styleIssues.length > 0) {
          diagnostics.push(`风格警告: ${styleIssues.join('; ')}`);
        }
      }
      // Auto-4: Semantic verification — import and reference check (non-blocking)
      try {
        const semIssues = await checkSemanticConsistency(currentChanges, rootPath);
        if (semIssues.length > 0) {
          diagnostics.push(`语义提示: ${semIssues.slice(0, 3).join('; ')}`);
        }
      } catch { /* best-effort */ }
      // Clean up temp files
      for (const tf of tempFiles) {
        try { const fs = await import('fs/promises'); await fs.unlink(tf.temp); } catch { /* best-effort */ }
      }
      return { passed: true, changes: currentChanges, fixes: totalFixes, diagnostics: diagnostics.join('\n') };
    }

    // Compile failed — try AI fix
    if (round < MAX_FIX_ROUNDS && provider && identity.language === 'TypeScript') {
      const errors = parseErrorOutput(compileResult.errors);
      if (errors.length > 0) {
        diagnostics.push(`第${round + 1}轮编译失败: ${errors.length} 个错误`);

        try {
          const fixResp = await provider.chat({
            systemPrompt: '你是TypeScript修复专家。只输出JSON变更契约。仅修复编译错误，不改无关代码，不引入新错误。',
            task: `修复以下 TypeScript 编译错误:\n${errors.map(e => `${e.file}:${e.line}: ${e.message}`).join('\n')}\n\n当前代码:\n${currentChanges.map(c => `## ${c.file}\n${c.content.slice(0, 2000)}`).join('\n\n')}`,
            context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
          });

          const j = JSON.parse((fixResp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
          const fixes = (j.changes || []) as { file: string; content: string }[];
          if (fixes.length > 0) {
            for (const fix of fixes) {
              const idx = currentChanges.findIndex(c => c.file === fix.file);
              if (idx >= 0) currentChanges[idx] = { file: fix.file, content: fix.content };
            }
            totalFixes++;
          } else {
            break; // AI produced no fix, stop trying
          }
        } catch { break; } // AI fix call failed, stop trying
      } else {
        break; // No parseable errors, can't fix
      }
    } else {
      break; // Last round or non-TS language
    }

    // Clean up temp files between rounds
    for (const tf of tempFiles) {
      try { const fs = await import('fs/promises'); await fs.unlink(tf.temp); } catch { /* best-effort */ }
    }
  }

  // All rounds exhausted, compile still failing
  diagnostics.push(`编译验证失败 (${MAX_FIX_ROUNDS}轮修复后)，变更已拒绝`);
  // Clean up all temp files
  for (const tf of allTempFiles) { try { const fs = await import('fs/promises'); await fs.unlink(tf); } catch { /* best-effort */ } }
  return { passed: false, changes: currentChanges, fixes: totalFixes, diagnostics: diagnostics.join('\n') };
}

interface TempFile { original: string; temp: string; content: string; }

export async function runCompileCheck(
  _tempFiles: TempFile[],
  rootPath: string,
  identity: { language: string },
): Promise<{ passed: boolean; errors: string }> {
  const lang = identity.language?.toLowerCase() || '';

  if (lang === 'typescript' || lang === 'javascript') {
    try {
      const { execFileSync } = await import('child_process');
      const hasTsConfig = await (await import('../utils/fs.js')).fileExists([rootPath, 'tsconfig.json'].join('/').replace(/\/+/g, '/'));
      if (!hasTsConfig) return { passed: true, errors: '' };

      const np = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const result = execFileSync(np, ['tsc', '--noEmit'], {
        cwd: rootPath,
        timeout: 30000,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return { passed: true, errors: '' };
    } catch (e: any) {
      return { passed: false, errors: (e.stdout || '') + (e.stderr || '') };
    }
  }

  if (lang === 'go') {
    try {
      const { execFileSync } = await import('child_process');
      execFileSync('go', ['build', './...'], { cwd: rootPath, timeout: 30000, encoding: 'utf-8', stdio: 'pipe' });
      return { passed: true, errors: '' };
    } catch (e: any) {
      return { passed: false, errors: (e.stdout || '') + (e.stderr || '') };
    }
  }

  if (lang === 'rust') {
    try {
      const { execFileSync } = await import('child_process');
      execFileSync('cargo', ['check'], { cwd: rootPath, timeout: 60000, encoding: 'utf-8', stdio: 'pipe' });
      return { passed: true, errors: '' };
    } catch (e: any) {
      return { passed: false, errors: (e.stdout || '') + (e.stderr || '') };
    }
  }

  if (lang === 'java') {
    try {
      const { execFileSync } = await import('child_process');
      const mvnw = process.platform === 'win32' ? 'mvnw.cmd' : './mvnw';
      const hasMvnw = await (await import('../utils/fs.js')).fileExists([rootPath, mvnw].join('/').replace(/\/+/g, '/'));
      if (hasMvnw) {
        execFileSync(mvnw, ['compile', '-q'], { cwd: rootPath, timeout: 60000, encoding: 'utf-8', stdio: 'pipe' });
      } else {
        const mvn = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
        execFileSync(mvn, ['compile', '-q'], { cwd: rootPath, timeout: 60000, encoding: 'utf-8', stdio: 'pipe' });
      }
      return { passed: true, errors: '' };
    } catch (e: any) {
      return { passed: false, errors: (e.stdout || '') + (e.stderr || '') };
    }
  }

  if (lang === 'csharp') {
    try {
      const { execFileSync } = await import('child_process');
      execFileSync('dotnet', ['build', '--no-restore'], { cwd: rootPath, timeout: 60000, encoding: 'utf-8', stdio: 'pipe' });
      return { passed: true, errors: '' };
    } catch (e: any) {
      return { passed: false, errors: (e.stdout || '') + (e.stderr || '') };
    }
  }

  // Interpreted / non-compiled languages (python, javascript, ruby, php, etc.) — skip enforcement
  return { passed: true, errors: '' };
}

// Auto-4: Semantic consistency — import and reference validation
async function checkSemanticConsistency(
  changes: { file: string; content: string }[],
  rootPath: string,
): Promise<string[]> {
  const issues: string[] = [];
  try {
    const { loadProjectIndex } = await import('../core/scanner.js');
    const idx = await loadProjectIndex(rootPath);
    if (!idx) return [];

    const knownModules = new Set(idx.modules.map(m => m.name));
    const knownExports = new Set<string>();
    for (const mod of idx.modules) {
      for (const exp of mod.exports) {
        knownExports.add(exp.name);
      }
    }

    for (const c of changes) {
      if (!/\.(ts|tsx|js|jsx)$/.test(c.file)) continue;

      // Extract relative imports: from './xxx' or from "../xxx"
      const importPattern = /from\s+['"]\.\.?[\/\\]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importPattern.exec(c.content)) !== null) {
        const importPath = m[1];
        // Check if the imported module likely exists
        const basePath = c.file.replace(/\/[^/]+$/, '');
        const resolved = `${basePath}/${importPath}`.replace(/\/+/g, '/');
        const exists = knownModules.has(resolved) || [...knownModules].some(k => k.includes(importPath.split('/').pop() || ''));
        if (!exists && !importPath.startsWith('.')) {
          // Can't verify — skip external packages
        }
      }

      // Check for bare imports that might not exist
      const bareImportPattern = /from\s+['"]([^.][^'"]*)['"]/g;
      while ((m = bareImportPattern.exec(c.content)) !== null) {
        const pkg = m[1];
        // Check if it's in package.json
        if (pkg && !pkg.startsWith('@types/') && !/^(fs|path|os|http|https|url|crypto|stream|util|events|buffer|child_process|readline)$/.test(pkg)) {
          try {
            const { readFile } = await import('../utils/fs.js');
            const pkgJson = JSON.parse(await readFile([rootPath, 'package.json'].join('/').replace(/\/+/g, '/')));
            const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
            if (!deps[pkg] && !knownModules.has(pkg)) {
              issues.push(`${c.file}: 导入了未在 package.json 中声明的包 "${pkg}"`);
            }
          } catch { /* pkg.json not found */ }
        }
      }
    }
  } catch { /* best-effort */ }
  return issues.slice(0, 5);
}

// T1-4a: Detect empty/weak tests
export function detectEmptyTests(content: string, filePath: string): { isEmpty: boolean; hasAssertions: boolean; issues: string[] } {
  if (!/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath)) return { isEmpty: false, hasAssertions: true, issues: [] };

  const issues: string[] = [];
  const hasAssertions = /expect\(|assert\.|assert\(|\.to(Be|Equal|Contain|Throw|Match|Called|Have)\b|\.toBe|\.toEqual|\.ok|should\.|\.must\.|t\.(is|ok|not|pass|fail)\b/i.test(content);
  const hasTestBlock = /(it|test|describe)\(/.test(content);
  const hasOnlyComments = content.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('/*') && !l.trim().startsWith('*') && l.trim().length > 0).length < 3;

  if (!hasTestBlock) {
    issues.push('无测试块定义 (it/test/describe)');
  }
  if (!hasAssertions && hasTestBlock) {
    issues.push('测试无断言 (expect/assert/should)');
  }
  if (hasOnlyComments) {
    issues.push('测试仅有注释，无实际代码');
  }

  // Check for empty test blocks: it("x", () => {}) and common malformed variants.
  const emptyBody = String.raw`\{\s*(?:(?:\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)\s*)*\}`;
  const emptyInlineCallPattern = new RegExp(String.raw`\b(?:it|test)\s*\([\s\S]*?,\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*${emptyBody}\s*\)`, 'g');
  const detachedEmptyBlockPattern = new RegExp(String.raw`\b(?:it|test)\s*\([^)]*\)\s*,\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*${emptyBody}`, 'g');
  if (emptyInlineCallPattern.test(content) || detachedEmptyBlockPattern.test(content)) {
    issues.push('存在空测试块 (无实现的箭头函数)');
  }

  return {
    isEmpty: issues.length >= 2 || hasOnlyComments,
    hasAssertions,
    issues,
  };
}

/** T1-4a: Scan generated test files and flag empty/weak tests */
export function scanGeneratedTests(
  testFiles: { file: string; content: string }[],
): { file: string; isEmpty: boolean; hasAssertions: boolean; issues: string[] }[] {
  return testFiles
    .map(tf => ({ file: tf.file, ...detectEmptyTests(tf.content, tf.file) }))
    .filter(r => r.issues.length > 0);
}

function checkStyleConsistency(
  changes: { file: string; content: string }[],
  fingerprint: import('../types.js').StyleFingerprint,
): string[] {
  const issues: string[] = [];
  for (const c of changes) {
    if (!/\.(ts|tsx|js|jsx)$/.test(c.file)) continue;
    const lines = c.content.split('\n');

    // Check semicolons
    if (fingerprint.semicolons === false && lines.some(l => /;\s*$/.test(l.trim()) && !/for\s*\(/.test(l))) {
      issues.push(`${c.file}: 包含分号，项目约定无分号`);
    }
    if (fingerprint.semicolons === true && lines.length > 3) {
      const stmtLines = lines.filter(l => /^(import|export|const|let|var|return|console)/.test(l.trim()));
      const missingSemi = stmtLines.filter(l => !/;\s*$/.test(l.trim()) && !/\{$/.test(l.trim()));
      if (missingSemi.length > stmtLines.length * 0.5) {
        issues.push(`${c.file}: 缺少分号，项目约定必须有分号`);
      }
    }

    // Check quote style
    if (fingerprint.quoteStyle === 'single') {
      const doubleQuoteLines = lines.filter(l => /import.*"/.test(l) || /require\s*\(.*"/.test(l) || /from\s+"/.test(l));
      if (doubleQuoteLines.length > 0) issues.push(`${c.file}: 使用双引号，项目约定单引号`);
    }
  }
  return issues.slice(0, 5);
}

// C9: AI code refactoring
export async function refactorCode(
  filePath: string,
  instruction: string,
  rootPath: string,
  index: ProjectIndex | null,
  provider: AIProviderAdapter,
): Promise<{ original: string; refactored: string; explanation: string }> {
  const { readFile } = await import('../utils/fs.js');
  const original = await readFile(filePath);
  const styleConstraint = index?.styleFingerprint ? buildStyleConstraints(index.styleFingerprint) : '';

  const resp = await provider.chat({
    systemPrompt: [
      '你是代码重构专家。分析代码并进行安全重构。',
      '规则:',
      '  1. 保持公开 API 不变',
      '  2. 每次只改一个关注点',
      '  3. 输出 JSON: {"refactored": "完整重构后的代码", "explanation": "改了什么、为什么 (中文)"}',
      styleConstraint || '',
    ].filter(Boolean).join('\n'),
    task: `文件: ${filePath}\n重构指令: ${instruction}\n\n原始代码:\n${original.slice(0, 6000)}`,
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    history: '',
  });

  try {
    const json = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
    return {
      original,
      refactored: json.refactored || original,
      explanation: json.explanation || '',
    };
  } catch {
    return { original, refactored: original, explanation: 'AI 输出解析失败' };
  }
}
