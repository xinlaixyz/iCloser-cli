// AST Parser — tree-sitter based TypeScript/JavaScript code analysis
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const Parser: typeof import('tree-sitter') = require('tree-sitter');
const TypeScript: typeof import('tree-sitter-typescript') = require('tree-sitter-typescript');

export interface AstFunction {
  name: string;
  params: string[];
  returnType: string | null;
  isAsync: boolean;
  isExported: boolean;
  isDefault: boolean;
  line: number;
}

export interface AstClass {
  name: string;
  extends: string | null;
  implements: string[];
  methods: AstFunction[];
  properties: string[];
  isExported: boolean;
  isDefault: boolean;
  line: number;
}

export interface AstInterface {
  name: string;
  extends: string[];
  members: string[];
  isExported: boolean;
  line: number;
}

export interface AstExport {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'unknown';
  signature: string;
  isDefault: boolean;
  line: number;
}

export interface AstImport {
  source: string;
  symbols: string[];
  defaultImport: string | null;
  namespaceImport: string | null;
  isTypeOnly: boolean;
  isExternal: boolean;
  line: number;
}

export interface AstCallEdge {
  caller: string;
  callee: string;
  callerLine: number;
}

export interface ParsedFile {
  filePath: string;
  exports: AstExport[];
  imports: AstImport[];
  functions: AstFunction[];
  classes: AstClass[];
  interfaces: AstInterface[];
  callGraph: AstCallEdge[];
  error?: string;
}

let tsParser: InstanceType<typeof Parser> | null = null;
let tsxParser: InstanceType<typeof Parser> | null = null;

// tree-sitter Language type is not exported; grammar packages return it directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TreeSitterLanguage = any;

function getTsParser(): InstanceType<typeof Parser> {
  if (!tsParser) {
    tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript as TreeSitterLanguage);
  }
  return tsParser;
}

function getTsxParser(): InstanceType<typeof Parser> {
  if (!tsxParser) {
    tsxParser = new Parser();
    tsxParser.setLanguage(TypeScript.tsx as TreeSitterLanguage);
  }
  return tsxParser;
}

async function parseTsSourceFile(filePath: string): Promise<ParsedFile> {
  const isTsx = /\.tsx$/i.test(filePath);
  try {
    const source = await readFile(filePath, 'utf-8');
    const parser = isTsx ? getTsxParser() : getTsParser();
    const tree = parser.parse(source);
    return {
      filePath,
      exports: extractExports(tree.rootNode, source),
      imports: extractImports(tree.rootNode, source),
      functions: extractFunctions(tree.rootNode, source),
      classes: extractClasses(tree.rootNode, source),
      interfaces: extractInterfaces(tree.rootNode, source),
      callGraph: extractCallGraph(tree.rootNode, source),
    };
  } catch (err) {
    return {
      filePath,
      exports: [],
      imports: [],
      functions: [],
      classes: [],
      interfaces: [],
      callGraph: [],
      error: (err as Error).message,
    };
  }
}

function parseTsSourceText(source: string, isTsx = false): ParsedFile {
  try {
    const parser = isTsx ? getTsxParser() : getTsParser();
    const tree = parser.parse(source);

    // Check for syntax errors in the AST
    const hasError = hasErrorNode(tree.rootNode);

    const result: ParsedFile = {
      filePath: '<inline>',
      exports: extractExports(tree.rootNode, source),
      imports: extractImports(tree.rootNode, source),
      functions: extractFunctions(tree.rootNode, source),
      classes: extractClasses(tree.rootNode, source),
      interfaces: extractInterfaces(tree.rootNode, source),
      callGraph: extractCallGraph(tree.rootNode, source),
    };

    if (hasError) result.error = 'Syntax error in source';
    return result;
  } catch (err) {
    return {
      filePath: '<inline>',
      exports: [], imports: [], functions: [], classes: [], interfaces: [], callGraph: [],
      error: (err as Error).message,
    };
  }
}

function hasErrorNode(node: import('tree-sitter').SyntaxNode): boolean {
  if (node.type === 'ERROR' || node.type === 'MISSING') return true;
  for (let i = 0; i < node.childCount; i++) {
    if (hasErrorNode(node.child(i)!)) return true;
  }
  return false;
}

function extractExports(node: import('tree-sitter').SyntaxNode, source: string): AstExport[] {
  const exports: AstExport[] = [];

  function walk(n: import('tree-sitter').SyntaxNode) {
    if (n.type === 'export_statement') {
      const decl = n.childForFieldName('declaration');
      let isDefault = false;

      // Check children for default keyword
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child?.type === 'default') { isDefault = true; break; }
      }

      if (decl) {
        processDeclaration(decl, isDefault);
      } else {
        // Check for export_clause: export { A, B }
        for (const child of n.namedChildren) {
          if (child.type === 'export_clause') {
            for (const spec of child.namedChildren) {
              if (spec.type === 'export_specifier') {
                const sname = namedChildText(spec, 'name') || spec.namedChildren[0]?.text || spec.text;
                const alias = namedChildText(spec, 'alias');
                if (sname) exports.push({ name: alias || sname, kind: 'unknown', signature: alias ? `${sname} as ${alias}` : sname, isDefault: false, line: spec.startPosition.row + 1 });
              }
            }
          } else if (child.type === 'function_declaration' || child.type === 'class_declaration') {
            processDeclaration(child, true);
          } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
            for (const c of child.namedChildren) {
              if (c.type === 'variable_declarator') {
                const vname = namedChildText(c, 'name') || 'default';
                exports.push({ name: vname, kind: 'const', signature: source.substring(child.startIndex, child.endIndex).split('\n')[0].trim(), isDefault: true, line: child.startPosition.row + 1 });
              }
            }
          }
        }
      }
      return; // Don't recurse into export_statement children
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  function processDeclaration(decl: import('tree-sitter').SyntaxNode, isDefault: boolean) {
    if (decl.type === 'function_declaration' || decl.type === 'generator_function_declaration') {
      const name = namedChildText(decl, 'name');
      if (name) exports.push({ name, kind: 'function', signature: extractSignature(decl, source, 'function'), isDefault, line: decl.startPosition.row + 1 });
    } else if (decl.type === 'class_declaration') {
      const name = namedChildText(decl, 'name');
      if (name) exports.push({ name, kind: 'class', signature: extractSignature(decl, source, 'class'), isDefault, line: decl.startPosition.row + 1 });
    } else if (decl.type === 'interface_declaration') {
      const name = namedChildText(decl, 'name');
      if (name) exports.push({ name, kind: 'interface', signature: extractSignature(decl, source, 'interface'), isDefault: false, line: decl.startPosition.row + 1 });
    } else if (decl.type === 'type_alias_declaration') {
      const name = namedChildText(decl, 'name');
      if (name) exports.push({ name, kind: 'type', signature: source.substring(decl.startIndex, decl.endIndex).split('\n')[0].trim(), isDefault: false, line: decl.startPosition.row + 1 });
    } else if (decl.type === 'lexical_declaration') {
      for (const c of decl.namedChildren) {
        if (c.type === 'variable_declarator') {
          const vname = namedChildText(c, 'name');
          if (vname) exports.push({ name: vname, kind: 'const', signature: source.substring(decl.startIndex, decl.endIndex).split('\n')[0].trim(), isDefault, line: decl.startPosition.row + 1 });
        }
      }
    } else if (decl.type === 'enum_declaration') {
      const name = namedChildText(decl, 'name');
      if (name) exports.push({ name, kind: 'enum', signature: `enum ${name} {...}`, isDefault: false, line: decl.startPosition.row + 1 });
    }
  }

  walk(node);
  return exports;
}

function extractImports(node: import('tree-sitter').SyntaxNode, source: string): AstImport[] {
  const imports: AstImport[] = [];

  function walk(n: import('tree-sitter').SyntaxNode) {
    if (n.type === 'import_statement') {
      const sourceNode = n.childForFieldName('source');
      const importSource = sourceNode ? stripQuotes(sourceNode.text) : '';
      let defaultImport: string | null = null;
      let namespaceImport: string | null = null;
      const symbols: string[] = [];
      let isTypeOnly = false;

      // Check all children (not just named) for 'type' keyword
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child?.type === 'type') { isTypeOnly = true; break; }
      }

      for (const child of n.namedChildren) {
        if (child.type === 'import_clause') {
          for (const c of child.namedChildren) {
            if (c.type === 'identifier') {
              defaultImport = c.text;
            }
            if (c.type === 'namespace_import') {
              namespaceImport = namedChildText(c, 'name');
            }
            if (c.type === 'named_imports') {
              for (const spec of c.namedChildren) {
                if (spec.type === 'import_specifier') {
                  const sname = namedChildText(spec, 'name') || spec.namedChildren[0]?.text || spec.text;
                  if (sname) symbols.push(sname);
                }
              }
            }
          }
        }
      }

      if (importSource) {
        imports.push({
          source: importSource,
          symbols,
          defaultImport,
          namespaceImport,
          isTypeOnly,
          isExternal: !importSource.startsWith('.') && !importSource.startsWith('/'),
          line: n.startPosition.row + 1,
        });
      }
      return; // Don't recurse into import_statement
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return imports;
}

function extractFunctions(node: import('tree-sitter').SyntaxNode, source: string): AstFunction[] {
  const funcs: AstFunction[] = [];

  function walk(n: import('tree-sitter').SyntaxNode, inClass = false) {
    if (n.type === 'function_declaration' || n.type === 'generator_function_declaration') {
      const name = namedChildText(n, 'name') || '<anonymous>';
      const params = extractParams(n, source);
      const returnType = extractReturnType(n, source);
      funcs.push({
        name, params, returnType,
        isAsync: source.substring(n.startIndex, n.endIndex).startsWith('async'),
        isExported: isAncestorExport(n),
        isDefault: false,
        line: n.startPosition.row + 1,
      });
    }

    if (n.type === 'method_definition' && inClass) {
      const name = namedChildText(n, 'name') || '<anonymous>';
      const params = extractParams(n, source);
      const returnType = extractReturnType(n, source);
      funcs.push({
        name, params, returnType,
        isAsync: source.substring(n.startIndex, n.endIndex).startsWith('async'),
        isExported: false,
        isDefault: false,
        line: n.startPosition.row + 1,
      });
    }

    if (n.type === 'arrow_function') {
      // Skip anonymous arrows; only capture if part of a variable declaration
    }

    const nextInClass = inClass || n.type === 'class_declaration';
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!, nextInClass);
  }

  walk(node);
  return funcs;
}

function extractClasses(node: import('tree-sitter').SyntaxNode, source: string): AstClass[] {
  const classes: AstClass[] = [];

  function walk(n: import('tree-sitter').SyntaxNode) {
    if (n.type === 'class_declaration') {
      const name = namedChildText(n, 'name') || '<anonymous>';
      const extendsName = extractExtends(n, source);
      const impls = extractImplements(n, source);
      const methods: AstFunction[] = [];
      const properties: string[] = [];

      const body = n.childForFieldName('body');
      if (body) scanClassBody(body, source, methods, properties);

      classes.push({
        name, extends: extendsName, implements: impls,
        methods, properties,
        isExported: isAncestorExport(n),
        isDefault: false,
        line: n.startPosition.row + 1,
      });
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return classes;
}

function extractInterfaces(node: import('tree-sitter').SyntaxNode, source: string): AstInterface[] {
  const interfaces: AstInterface[] = [];

  function walk(n: import('tree-sitter').SyntaxNode) {
    if (n.type === 'interface_declaration') {
      const name = namedChildText(n, 'name') || '<anonymous>';
      const ext: string[] = [];
      const members: string[] = [];

      for (const child of n.namedChildren) {
        if (child.type === 'extends_type_clause') {
          for (const c of child.namedChildren) {
            const extName = getFullTypeName(c, source);
            if (extName) ext.push(extName);
          }
        }
        if (child.type === 'interface_body') {
          for (const member of child.namedChildren) {
            if (member.type === 'property_signature' || member.type === 'method_signature') {
              const mname = namedChildText(member, 'name');
              if (mname) members.push(mname);
            }
          }
        }
      }

      interfaces.push({
        name, extends: ext, members,
        isExported: isAncestorExport(n),
        line: n.startPosition.row + 1,
      });
      return;
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return interfaces;
}

function extractCallGraph(node: import('tree-sitter').SyntaxNode, source: string): AstCallEdge[] {
  const edges: AstCallEdge[] = [];
  let currentFunction = '<module>';

  function walk(n: import('tree-sitter').SyntaxNode) {
    if (n.type === 'function_declaration' || n.type === 'method_definition') {
      const saved = currentFunction;
      const name = namedChildText(n, 'name') || '<anonymous>';
      currentFunction = name;
      for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
      currentFunction = saved;
      return;
    }

    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn) {
        const callee = getCalleeName(fn, source);
        if (callee) {
          edges.push({ caller: currentFunction, callee, callerLine: n.startPosition.row + 1 });
        }
      }
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return edges;
}

// === helpers ===

function scanClassBody(
  body: import('tree-sitter').SyntaxNode, source: string,
  methods: AstFunction[], properties: string[]
) {
  for (const child of body.namedChildren) {
    if (child.type === 'method_definition') {
      const name = namedChildText(child, 'name');
      if (name) {
        methods.push({
          name, params: extractParams(child, source),
          returnType: extractReturnType(child, source),
          isAsync: source.substring(child.startIndex, child.endIndex).startsWith('async'),
          isExported: false, isDefault: false,
          line: child.startPosition.row + 1,
        });
      }
    }
    if (child.type === 'public_field_definition') {
      const pname = namedChildText(child, 'name');
      if (pname) properties.push(pname);
    }
  }
}

function namedChildText(node: import('tree-sitter').SyntaxNode, field: string): string | null {
  const child = node.childForFieldName ? node.childForFieldName(field) : null;
  if (!child) {
    for (const c of node.namedChildren) {
      if (field === 'name' && (c.type === 'identifier' || c.type === 'property_identifier' || c.type === 'type_identifier')) {
        return c.text;
      }
    }
    return null;
  }
  return child.text;
}

function extractParams(node: import('tree-sitter').SyntaxNode, source: string): string[] {
  const params: string[] = [];
  const formalParams = node.childForFieldName('parameters');
  if (!formalParams) return params;
  for (const child of formalParams.namedChildren) {
    if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
      params.push(source.substring(child.startIndex, child.endIndex).trim());
    }
  }
  return params;
}

function extractReturnType(node: import('tree-sitter').SyntaxNode, source: string): string | null {
  const returnType = node.childForFieldName('return_type');
  if (!returnType) return null;
  return source.substring(returnType.startIndex, returnType.endIndex).replace(/^:\s*/, '').trim();
}

function extractSignature(node: import('tree-sitter').SyntaxNode, source: string, kind: string): string {
  const maxLen = kind === 'interface' ? 80 : 100;
  const text = source.substring(node.startIndex, node.endIndex).split('\n')[0].trim();
  return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
}

function extractExtends(node: import('tree-sitter').SyntaxNode, source: string): string | null {
  // extends_clause is inside class_heritage
  for (const child of node.namedChildren) {
    if (child.type === 'class_heritage') {
      for (const h of child.namedChildren) {
        if (h.type === 'extends_clause') {
          const typeNode = h.namedChildren[0];
          return typeNode ? getFullTypeName(typeNode, source) : null;
        }
      }
    }
    // Also check direct extends_clause (backward compat)
    if (child.type === 'extends_clause') {
      const typeNode = child.namedChildren[0];
      return typeNode ? getFullTypeName(typeNode, source) : null;
    }
  }
  return null;
}

function extractImplements(node: import('tree-sitter').SyntaxNode, source: string): string[] {
  const impls: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'class_heritage') {
      for (const h of child.namedChildren) {
        if (h.type === 'implements_clause') {
          for (const c of h.namedChildren) {
            const name = getFullTypeName(c, source);
            if (name) impls.push(name);
          }
        }
      }
    }
    if (child.type === 'implements_clause') {
      for (const c of child.namedChildren) {
        const name = getFullTypeName(c, source);
        if (name) impls.push(name);
      }
    }
  }
  return impls;
}

function getFullTypeName(node: import('tree-sitter').SyntaxNode, source: string): string | null {
  if (node.type === 'type_identifier' || node.type === 'identifier') return node.text;
  if (node.type === 'generic_type') {
    const base = node.namedChildren[0]?.text || 'unknown';
    const args = node.namedChildren.slice(1).map(c => source.substring(c.startIndex, c.endIndex)).join(', ');
    return `${base}<${args}>`;
  }
  return node.text || source.substring(node.startIndex, node.endIndex);
}

function getCalleeName(node: import('tree-sitter').SyntaxNode, source: string): string | null {
  if (node.type === 'identifier' || node.type === 'property_identifier') return node.text;
  if (node.type === 'member_expression') {
    const obj = node.childForFieldName('object');
    const prop = node.childForFieldName('property');
    const objName = obj ? getCalleeName(obj, source) : '';
    const propName = prop ? getCalleeName(prop, source) : '';
    return objName && propName ? `${objName}.${propName}` : null;
  }
  return null;
}

function isAncestorExport(node: import('tree-sitter').SyntaxNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'export_statement') return true;
    current = current.parent;
  }
  return false;
}

function stripQuotes(text: string): string {
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1);
  }
  return text;
}

// ============================================================
// Go AST Parser
// ============================================================
let goParser: InstanceType<typeof Parser> | null = null;
let goLanguageAvailable = true;
let Go: TreeSitterLanguage | null = null;
try { Go = require('tree-sitter-go').language || require('tree-sitter-go'); } catch { goLanguageAvailable = false; }

function getGoParser(): InstanceType<typeof Parser> {
  if (!goLanguageAvailable || !Go) throw new Error('tree-sitter-go grammar unavailable (ABI mismatch or not installed)');
  if (!goParser) { goParser = new Parser(); goParser.setLanguage(Go); }
  return goParser;
}

export function parseGoSourceText(source: string): ParsedFile {
  try {
    const parser = getGoParser();
    const tree = parser.parse(source);
    return {
      filePath: '<inline>',
      exports: extractGoExports(tree.rootNode, source),
      imports: extractGoImports(tree.rootNode, source),
      functions: extractGoFunctions(tree.rootNode, source),
      classes: [],
      interfaces: extractGoInterfaces(tree.rootNode, source),
      callGraph: extractGoCallGraph(tree.rootNode, source),
    };
  } catch {
    return parseGoRegex(source);
  }
}

export async function parseGoSourceFile(filePath: string): Promise<ParsedFile> {
  try {
    const source = await readFile(filePath, 'utf-8');
    const result = parseGoSourceText(source);
    return { ...result, filePath, error: undefined };
  } catch (err) {
    return { filePath, exports: [], imports: [], functions: [], classes: [], interfaces: [], callGraph: [], error: (err as Error).message };
  }
}

function extractGoExports(node: TreeSitterSyntaxNode, source: string): AstExport[] {
  const exports: AstExport[] = [];
  const seen = new Set<string>();

  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'function_declaration') {
      const name = goNodeName(n);
      if (name && isGoExported(name) && !seen.has(name)) {
        seen.add(name);
        exports.push({ name, kind: 'function', signature: goSignature(n, source, 'func'), isDefault: false, line: n.startPosition.row + 1 });
      }
    } else if (n.type === 'method_declaration') {
      const name = goNodeName(n);
      if (name && isGoExported(name) && !seen.has(name)) {
        seen.add(name);
        exports.push({ name, kind: 'function', signature: goSignature(n, source, 'method'), isDefault: false, line: n.startPosition.row + 1 });
      }
    } else if (n.type === 'type_declaration') {
      for (const spec of n.namedChildren) {
        if (spec.type === 'type_spec') {
          const tname = goNodeName(spec);
          if (tname && isGoExported(tname) && !seen.has(tname)) {
            seen.add(tname);
            const body = spec.namedChildren.find(c => c.type === 'struct_type' || c.type === 'interface_type' || c.type === 'function_type');
            const kind: AstExport['kind'] = body?.type === 'interface_type' ? 'interface' : body?.type === 'struct_type' ? 'class' : 'type';
            exports.push({ name: tname, kind, signature: goSignature(spec, source, 'type'), isDefault: false, line: spec.startPosition.row + 1 });
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return exports;
}

function extractGoImports(node: TreeSitterSyntaxNode, source: string): AstImport[] {
  const imports: AstImport[] = [];

  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'import_declaration') {
      for (const child of n.namedChildren) {
        if (child.type === 'import_spec') {
          goAddImportSpec(child, imports);
        } else if (child.type === 'import_spec_list') {
          for (const spec of child.namedChildren) {
            if (spec.type === 'import_spec') goAddImportSpec(spec, imports);
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return imports;
}

function goAddImportSpec(spec: TreeSitterSyntaxNode, imports: AstImport[]) {
  // Extract the package path — first string literal content
  let sourcePath = '';
  for (const c of spec.namedChildren) {
    if (c.type === 'interpreted_string_literal' || c.type === 'raw_string_literal') {
      sourcePath = stripQuotes(c.text);
      break;
    }
  }
  if (!sourcePath) sourcePath = stripQuotes(spec.text) || spec.text;
  let alias: string | null = null;
  for (const c of spec.namedChildren) {
    if (c.type === 'package_identifier' || c.type === 'identifier' || c.type === 'blank_identifier') {
      alias = c.text;
    }
  }
  const isExternal = !sourcePath.startsWith('.') && !sourcePath.startsWith('/') && !sourcePath.includes('/internal/');
  imports.push({ source: sourcePath, symbols: alias ? [alias] : [], defaultImport: alias, namespaceImport: null, isTypeOnly: false, isExternal, line: spec.startPosition.row + 1 });
}

function extractGoFunctions(node: TreeSitterSyntaxNode, source: string): AstFunction[] {
  const funcs: AstFunction[] = [];

  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'function_declaration') {
      const name = goNodeName(n) || '<anonymous>';
      const params = goExtractParams(n, source);
      const returnType = goExtractReturnType(n, source);
      funcs.push({ name, params, returnType, isAsync: false, isExported: isGoExported(name), isDefault: false, line: n.startPosition.row + 1 });
    } else if (n.type === 'method_declaration') {
      const name = goNodeName(n) || '<anonymous>';
      const params = goExtractParams(n, source);
      const returnType = goExtractReturnType(n, source);
      funcs.push({ name, params, returnType, isAsync: false, isExported: isGoExported(name), isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return funcs;
}

function extractGoInterfaces(node: TreeSitterSyntaxNode, source: string): AstInterface[] {
  const interfaces: AstInterface[] = [];

  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'type_declaration') {
      for (const spec of n.namedChildren) {
        if (spec.type === 'type_spec') {
          const tname = goNodeName(spec);
          if (!tname) continue;
          const body = spec.namedChildren.find(c => c.type === 'interface_type');
          if (!body) continue;
          const members: string[] = [];
          for (const c of body.namedChildren) {
            if (c.type === 'method_spec' || c.type === 'field_declaration') {
              const mname = goNodeName(c);
              if (mname) members.push(mname);
            }
          }
          interfaces.push({ name: tname, extends: [], members, isExported: isGoExported(tname), line: spec.startPosition.row + 1 });
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return interfaces;
}

function extractGoCallGraph(node: TreeSitterSyntaxNode, source: string): AstCallEdge[] {
  const edges: AstCallEdge[] = [];
  let currentFn = '<module>';

  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'function_declaration' || n.type === 'method_declaration') {
      const saved = currentFn;
      currentFn = goNodeName(n) || '<anonymous>';
      for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
      currentFn = saved;
      return;
    }
    if (n.type === 'call_expression') {
      const callee = goCalleeName(n, source);
      if (callee) edges.push({ caller: currentFn, callee, callerLine: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return edges;
}

function isGoExported(name: string): boolean {
  return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== '_';
}

function goNodeName(node: TreeSitterSyntaxNode): string | null {
  const nameNode = node.childForFieldName ? node.childForFieldName('name') : null;
  if (nameNode) return nameNode.text;
  for (const c of node.namedChildren) {
    if (c.type === 'identifier' || c.type === 'field_identifier' || c.type === 'type_identifier' || c.type === 'package_identifier') return c.text;
  }
  return null;
}

function goSignature(node: TreeSitterSyntaxNode, source: string, kind: string): string {
  const text = source.substring(node.startIndex, node.endIndex).split('\n')[0].trim();
  return text.length > 100 ? text.substring(0, 100) + '…' : text;
}

function goExtractParams(node: TreeSitterSyntaxNode, source: string): string[] {
  const params: string[] = [];
  const paramList = node.childForFieldName ? node.childForFieldName('parameters') : null;
  if (!paramList) return params;
  for (const child of paramList.namedChildren) {
    if (child.type === 'parameter_declaration') {
      // In Go, a param can be like "name type" or just "type"
      const names = child.namedChildren.filter(c => c.type === 'identifier');
      const typeNode = child.childForFieldName ? child.childForFieldName('type') : null;
      const typeStr = typeNode ? source.substring(typeNode.startIndex, typeNode.endIndex) : 'any';
      if (names.length > 0) {
        for (const n of names) params.push(`${n.text} ${typeStr}`);
      } else {
        params.push(typeStr);
      }
    }
  }
  return params;
}

function goExtractReturnType(node: TreeSitterSyntaxNode, source: string): string | null {
  const result = node.childForFieldName ? node.childForFieldName('result') : null;
  if (!result) return null;
  return source.substring(result.startIndex, result.endIndex).trim();
}

function goCalleeName(node: TreeSitterSyntaxNode, source: string): string | null {
  const fn = node.childForFieldName ? node.childForFieldName('function') : null;
  if (!fn) return null;
  if (fn.type === 'identifier') return fn.text;
  if (fn.type === 'selector_expression') {
    const operand = fn.childForFieldName ? fn.childForFieldName('operand') : null;
    const field = fn.childForFieldName ? fn.childForFieldName('field') : null;
    return operand && field ? `${operand.text}.${field.text}` : field?.text || null;
  }
  return fn.text || null;
}

// ============================================================
// Python AST Parser
// ============================================================
let pyParser: InstanceType<typeof Parser> | null = null;
let pyLanguageAvailable = true;
let Python: TreeSitterLanguage | null = null;
try { Python = require('tree-sitter-python').language || require('tree-sitter-python'); } catch { pyLanguageAvailable = false; }

function getPyParser(): InstanceType<typeof Parser> {
  if (!pyLanguageAvailable || !Python) throw new Error('tree-sitter-python grammar unavailable (ABI mismatch or not installed)');
  if (!pyParser) { pyParser = new Parser(); pyParser.setLanguage(Python); }
  return pyParser;
}

export function parsePythonSourceText(source: string): ParsedFile {
  try {
    const parser = getPyParser();
    const tree = parser.parse(source);
    return {
      filePath: '<inline>',
      exports: extractPythonExports(tree.rootNode, source),
      imports: extractPythonImports(tree.rootNode, source),
      functions: extractPythonFunctions(tree.rootNode, source),
      classes: extractPythonClasses(tree.rootNode, source),
      interfaces: [],
      callGraph: [],
    };
  } catch {
    return parsePythonRegex(source);
  }
}

export async function parsePythonSourceFile(filePath: string): Promise<ParsedFile> {
  try {
    const source = await readFile(filePath, 'utf-8');
    const result = parsePythonSourceText(source);
    return { ...result, filePath, error: undefined };
  } catch (err) {
    return { filePath, exports: [], imports: [], functions: [], classes: [], interfaces: [], callGraph: [], error: (err as Error).message };
  }
}

// ============================================================
// Go regex-based fallback parser (when tree-sitter ABI is unavailable)
// ============================================================
function parseGoRegex(source: string): ParsedFile {
  const exports: AstExport[] = [];
  const imports: AstImport[] = [];
  const funcs: AstFunction[] = [];
  const interfaces: AstInterface[] = [];
  const callGraph: AstCallEdge[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Single import: import "pkg"
    let m = line.match(/^import\s+"([^"]+)"/);
    if (m) { imports.push({ source: m[1], symbols: [m[1].split('/').pop()!], defaultImport: null, namespaceImport: null, isTypeOnly: false, isExternal: true, line: lineNum }); continue; }

    // import alias: import alias "pkg"
    m = line.match(/^import\s+(\w+)\s+"([^"]+)"/);
    if (m) { imports.push({ source: m[2], symbols: [m[1]], defaultImport: m[1], namespaceImport: null, isTypeOnly: false, isExternal: true, line: lineNum }); continue; }

    // Grouped import block: import ( ... )
    if (line === 'import (' || line.startsWith('import (')) {
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const iline = lines[j].trim();
        if (iline === ')') break;
        const im = iline.match(/^"([^"]+)"/) || iline.match(/^(\w+)\s+"([^"]+)"/);
        if (im) {
          const src = im[2] || im[1]; const alias = im[2] ? im[1] : null;
          imports.push({ source: src, symbols: [alias || src.split('/').pop()!], defaultImport: alias, namespaceImport: null, isTypeOnly: false, isExternal: true, line: j + 1 });
        }
      }
      continue;
    }

    // func (receiver Type) Method(params) ReturnType — check before plain func
    m = line.match(/^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(([^)]*)\)\s*(.*)$/);
    if (m) {
      const name = m[3]; const params = goRegexExtractParams(m[4]);
      const ret = goRegexCleanReturnType(m[5]) || null;
      const isExported = /^[A-Z]/.test(name);
      funcs.push({ name, params, returnType: ret, isAsync: false, isExported, isDefault: false, line: lineNum });
      if (isExported) exports.push({ name, kind: 'function', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      continue;
    }

    // func Name(params) ReturnType
    m = line.match(/^func\s+(\w+)\s*\(([^)]*)\)\s*(.*)$/);
    if (m && !m[1].startsWith('(')) {
      const name = m[1]; const params = goRegexExtractParams(m[2]);
      const ret = goRegexCleanReturnType(m[3]) || null;
      const isExported = /^[A-Z]/.test(name);
      funcs.push({ name, params, returnType: ret, isAsync: false, isExported, isDefault: false, line: lineNum });
      exports.push({ name, kind: 'function', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      goRegexExtractCalls(name, i, lines, callGraph);
      continue;
    }

    // type Name struct { ... }
    m = line.match(/^type\s+(\w+)\s+struct\s*\{/);
    if (m) {
      const name = m[1]; const isExported = /^[A-Z]/.test(name);
      exports.push({ name, kind: 'class', signature: `type ${name} struct`, isDefault: false, line: lineNum });
      continue;
    }

    // type Name interface { ... }
    m = line.match(/^type\s+(\w+)\s+interface\s*\{/);
    if (m) {
      const name = m[1]; const isExported = /^[A-Z]/.test(name);
      interfaces.push({ name, extends: [], members: [], isExported, line: lineNum });
      exports.push({ name, kind: 'interface', signature: `type ${name} interface`, isDefault: false, line: lineNum });
      continue;
    }

    // type Name SomeType (type alias)
    m = line.match(/^type\s+(\w+)\s+(\w[\w.]*)/);
    if (m && m[2] !== 'struct' && m[2] !== 'interface') {
      const name = m[1]; const isExported = /^[A-Z]/.test(name);
      if (isExported) exports.push({ name, kind: 'type', signature: line.substring(0, 100), isDefault: false, line: lineNum });
    }
  }

  return { filePath: '<inline>', exports, imports, functions: funcs, classes: [], interfaces, callGraph };
}

function goRegexCleanReturnType(raw: string): string | null {
  // Strip leading/trailing whitespace, '{', and anything after '{'
  let ret = raw.trim();
  ret = ret.replace(/\{.*/, '').trim();
  return ret || null;
}

function goRegexExtractParams(paramStr: string): string[] {
  if (!paramStr.trim()) return [];
  return paramStr.split(',').map(p => p.trim().split(/\s+/)[0] || p.trim()).filter(Boolean);
}

function goRegexExtractCalls(funcName: string, startLine: number, lines: string[], callGraph: AstCallEdge[]): void {
  for (let i = startLine + 1; i < Math.min(startLine + 30, lines.length); i++) {
    const line = lines[i].trim();
    if (line === '}' || line === '') break;
    const calls = line.matchAll(/\b(\w+)\(/g);
    for (const c of calls) {
      if (c[1] !== funcName && /^[A-Za-z]/.test(c[1])) {
        callGraph.push({ caller: funcName, callee: c[1], callerLine: startLine + 1 });
      }
    }
  }
}

// ============================================================
// Python regex-based fallback parser (when tree-sitter ABI is unavailable)
// ============================================================
function parsePythonRegex(source: string): ParsedFile {
  const exports: AstExport[] = [];
  const imports: AstImport[] = [];
  const funcs: AstFunction[] = [];
  const classes: AstClass[] = [];
  const callGraph: AstCallEdge[] = [];
  const lines = source.split('\n');
  let inAsyncDef = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // import module
    let m = line.match(/^import\s+(\w[\w.]*)/);
    if (m) { imports.push({ source: m[1], symbols: [m[1].split('.')[0]], defaultImport: null, namespaceImport: null, isTypeOnly: false, isExternal: true, line: lineNum }); continue; }

    // from module import name
    m = line.match(/^from\s+(\w[\w.]*)\s+import\s+(.+)/);
    if (m) {
      const symbols = m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      imports.push({ source: m[1], symbols, defaultImport: null, namespaceImport: null, isTypeOnly: false, isExternal: !m[1].startsWith('.'), line: lineNum });
      continue;
    }

    // @decorator — mark next line as decorated
    if (line.startsWith('@')) { inAsyncDef = true; continue; }

    // async def name(params) -> Type:
    const asyncMatch = line.match(/^async\s+def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*(\S+))?\s*:/);
    if (asyncMatch) {
      const name = asyncMatch[1]; const params = pyRegexExtractParams(asyncMatch[2]);
      const returnType = asyncMatch[4] || null;
      funcs.push({ name, params, returnType, isAsync: true, isExported: !name.startsWith('_'), isDefault: false, line: lineNum });
      exports.push({ name, kind: 'function', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      pyRegexExtractCalls(name, i, lines, callGraph);
      inAsyncDef = false; continue;
    }

    // def name(params) -> Type:
    m = line.match(/^def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*(\S+))?\s*:/);
    if (m) {
      const name = m[1]; const params = pyRegexExtractParams(m[2]);
      const returnType = m[4] || null;
      const isExported = !name.startsWith('_');
      funcs.push({ name, params, returnType, isAsync: inAsyncDef, isExported, isDefault: false, line: lineNum });
      exports.push({ name, kind: 'function', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      pyRegexExtractCalls(name, i, lines, callGraph);
      inAsyncDef = false; continue;
    }

    // class Name(Base1, Base2):
    m = line.match(/^class\s+(\w+)\s*(\(([^)]*)\))?\s*:/);
    if (m) {
      const name = m[1]; const bases = m[3] ? m[3].split(',').map(b => b.trim()).filter(Boolean) : [];
      const extendsName = bases.length > 0 ? bases[0] : null;
      const isExported = !name.startsWith('_');
      const methods: AstFunction[] = [];
      // Extract methods from class body (indented def lines until outdent)
      const baseIndent = lines[i].match(/^(\s*)/)?.[1] || '';
      for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
        const cline = lines[j];
        const cindent = cline.match(/^(\s*)/)?.[1] || '';
        if (cline.trim() === '') continue;
        if (cindent.length <= baseIndent.length) break; // outdented — end of class
        const trimmed = cline.trim();
        const dm = trimmed.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
        if (dm) {
          const mname = dm[1]; const mparams = pyRegexExtractParams(dm[2]);
          methods.push({ name: mname, params: mparams, returnType: null, isAsync: false, isExported: !mname.startsWith('_'), isDefault: false, line: j + 1 });
        }
      }
      const properties = methods.map(m => m.name);
      classes.push({ name, extends: extendsName, implements: [], methods, properties, isExported, isDefault: false, line: lineNum });
      exports.push({ name, kind: 'class', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      inAsyncDef = false; continue;
    }

    inAsyncDef = false;
  }

  return { filePath: '<inline>', exports, imports, functions: funcs, classes, interfaces: [], callGraph };
}

function pyRegexExtractParams(paramStr: string): string[] {
  if (!paramStr.trim()) return [];
  return paramStr.split(',').map(p => {
    const trimmed = p.trim();
    // Handle "name: Type" or "name: Type = default"
    const parts = trimmed.split(':');
    const namePart = parts[0].trim();
    // Handle *args, **kwargs
    if (namePart.startsWith('**')) return namePart;
    if (namePart.startsWith('*')) return namePart;
    return namePart || trimmed;
  }).filter(Boolean);
}

function pyRegexExtractCalls(funcName: string, startLine: number, lines: string[], callGraph: AstCallEdge[]): void {
  let indent = '';
  const firstLine = lines[startLine];
  const m = firstLine.match(/^(\s*)/);
  if (m) indent = m[1] + '    ';
  for (let i = startLine + 1; i < Math.min(startLine + 50, lines.length); i++) {
    const line = lines[i];
    // Stop at dedent or blank line
    if (line.trim() === '') continue;
    if (line.length > 0 && !line.startsWith(indent) && !line.startsWith('\t') && line.trim() !== '') {
      if (!line.startsWith(' ') && !line.startsWith('\t') && line.trim()) break;
    }
    const calls = line.matchAll(/\b(\w+)\(/g);
    for (const c of calls) {
      if (c[1] !== funcName && /^[A-Za-z_]/.test(c[1]) && !['if', 'for', 'while', 'with', 'print', 'len', 'range', 'int', 'str', 'list', 'dict', 'set', 'tuple', 'bool', 'float'].includes(c[1])) {
        callGraph.push({ caller: funcName, callee: c[1], callerLine: startLine + 1 });
      }
    }
  }
}

function extractPythonExports(node: TreeSitterSyntaxNode, source: string): AstExport[] {
  const exports: AstExport[] = [];

  function walk(n: TreeSitterSyntaxNode, isTopLevel: boolean) {
    if (!isTopLevel) {
      // Only collect top-level declarations
    } else if (n.type === 'function_definition') {
      const name = pyNodeName(n);
      if (name) exports.push({ name, kind: 'function', signature: pySignature(n, source), isDefault: false, line: n.startPosition.row + 1 });
    } else if (n.type === 'class_definition') {
      const name = pyNodeName(n);
      if (name) exports.push({ name, kind: 'class', signature: pySignature(n, source), isDefault: false, line: n.startPosition.row + 1 });
    } else if (n.type === 'decorated_definition') {
      // Decorated function or class
      for (const child of n.namedChildren) {
        if (child.type === 'function_definition') {
          const dname = pyNodeName(child);
          if (dname) exports.push({ name: dname, kind: 'function', signature: pySignature(child, source), isDefault: false, line: child.startPosition.row + 1 });
        } else if (child.type === 'class_definition') {
          const dname = pyNodeName(child);
          if (dname) exports.push({ name: dname, kind: 'class', signature: pySignature(child, source), isDefault: false, line: child.startPosition.row + 1 });
        }
      }
    }

    const nextTopLevel = isTopLevel && (n.type === 'module' || n.parent?.type === 'module' || n.parent === null);
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)!;
      // Only recurse one level from module
      if (n.type === 'module') {
        walk(child, true);
      } else if (isTopLevel && (n.type === 'function_definition' || n.type === 'class_definition' || n.type === 'decorated_definition')) {
        // Don't recurse into function/class bodies for exports
      } else if (isTopLevel) {
        walk(child, false);
      }
    }
  }

  walk(node, node.type === 'module');
  return exports;
}

function extractPythonImports(node: TreeSitterSyntaxNode, source: string): AstImport[] {
  const imports: AstImport[] = [];

  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'import_statement') {
      for (const c of n.namedChildren) {
        if (c.type === 'dotted_name') {
          imports.push({ source: c.text, symbols: [c.text.split('.').pop() || c.text], defaultImport: null, namespaceImport: c.text, isTypeOnly: false, isExternal: true, line: n.startPosition.row + 1 });
        } else if (c.type === 'aliased_import') {
          const alias = pyNodeName(c);
          const dotted = c.namedChildren.find(ch => ch.type === 'dotted_name');
          imports.push({ source: dotted?.text || alias || c.text, symbols: alias ? [alias] : [], defaultImport: null, namespaceImport: dotted?.text || null, isTypeOnly: false, isExternal: true, line: n.startPosition.row + 1 });
        }
      }
    } else if (n.type === 'import_from_statement') {
      const dottedNames = n.namedChildren.filter(c => c.type === 'dotted_name');
      const moduleName = dottedNames[0]?.text || '';
      const symbols: string[] = [];
      // First dotted_name = module, rest = imported symbols
      for (let i = 1; i < dottedNames.length; i++) {
        symbols.push(dottedNames[i].text.split('.').pop() || dottedNames[i].text);
      }
      for (const c of n.namedChildren) {
        if (c.type === 'aliased_import') symbols.push(pyNodeName(c) || c.text);
      }
      imports.push({ source: moduleName, symbols, defaultImport: null, namespaceImport: null, isTypeOnly: false, isExternal: !moduleName.startsWith('.'), line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return imports;
}

function extractPythonFunctions(node: TreeSitterSyntaxNode, source: string): AstFunction[] {
  const funcs: AstFunction[] = [];

  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'function_definition') {
      const name = pyNodeName(n) || '<anonymous>';
      const params = pyExtractParams(n, source);
      const returnType = pyExtractReturnType(n, source);
      funcs.push({ name, params, returnType, isAsync: pyIsAsync(n, source), isExported: true, isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return funcs;
}

function extractPythonClasses(node: TreeSitterSyntaxNode, source: string): AstClass[] {
  const classes: AstClass[] = [];

  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'class_definition') {
      const name = pyNodeName(n) || '<anonymous>';
      const bases: string[] = [];
      const methods: AstFunction[] = [];
      const properties: string[] = [];

      const superclasses = n.childForFieldName ? n.childForFieldName('superclasses') : null;
      if (superclasses) {
        for (const c of superclasses.namedChildren) {
          if (c.type === 'identifier' || c.type === 'attribute') bases.push(c.text);
        }
      }

      const body = n.childForFieldName ? n.childForFieldName('body') : null;
      if (body) pyScanClassBody(body, source, methods, properties);

      classes.push({ name, extends: bases.length > 0 ? bases[0] : null, implements: bases, methods, properties, isExported: true, isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }

  walk(node);
  return classes;
}

function pyScanClassBody(body: TreeSitterSyntaxNode, source: string, methods: AstFunction[], properties: string[]) {
  for (const child of body.namedChildren) {
    if (child.type === 'function_definition') {
      const mname = pyNodeName(child);
      if (mname) {
        methods.push({ name: mname, params: pyExtractParams(child, source), returnType: pyExtractReturnType(child, source), isAsync: pyIsAsync(child, source), isExported: false, isDefault: false, line: child.startPosition.row + 1 });
      }
    } else if (child.type === 'expression_statement') {
      // Could be an assignment (property)
      const assign = child.namedChildren[0];
      if (assign?.type === 'assignment') {
        const target = assign.childForFieldName?.('left') || assign.namedChildren[0];
        if (target && (target.type === 'identifier' || target.type === 'attribute')) {
          properties.push(target.text);
        }
      }
    }
  }
}

function pyNodeName(node: TreeSitterSyntaxNode): string | null {
  const nameNode = node.childForFieldName ? node.childForFieldName('name') : null;
  if (nameNode) return nameNode.text;
  for (const c of node.namedChildren) {
    if (c.type === 'identifier') return c.text;
  }
  return null;
}

function pySignature(node: TreeSitterSyntaxNode, source: string): string {
  const text = source.substring(node.startIndex, node.endIndex).split('\n')[0].trim();
  // Remove leading 'def ' or 'class ' for brevity? No, keep it.
  return text.length > 100 ? text.substring(0, 100) + '…' : text;
}

function pyExtractParams(node: TreeSitterSyntaxNode, source: string): string[] {
  const params: string[] = [];
  const paramList = node.childForFieldName ? node.childForFieldName('parameters') : null;
  if (!paramList) return params;
  for (const child of paramList.namedChildren) {
    if (child.type === 'identifier' || child.type === 'default_parameter' || child.type === 'typed_parameter' || child.type === 'typed_default_parameter' || child.type === 'list_splat_pattern' || child.type === 'dictionary_splat_pattern' || child.type === 'keyword_argument') {
      params.push(source.substring(child.startIndex, child.endIndex).trim());
    }
  }
  return params;
}

function pyExtractReturnType(node: TreeSitterSyntaxNode, source: string): string | null {
  const returnType = node.childForFieldName ? node.childForFieldName('return_type') : null;
  if (!returnType) return null;
  return source.substring(returnType.startIndex, returnType.endIndex).replace(/^->\s*/, '').trim();
}

function pyIsAsync(node: TreeSitterSyntaxNode, source: string): boolean {
  const prefix = source.substring(node.startIndex, node.startIndex + 6);
  return prefix.startsWith('async');
}

// ============================================================
// Java AST Parser (tree-sitter)
// ============================================================
let javaParser: InstanceType<typeof Parser> | null = null;
let javaLanguageAvailable = true;
let Java: TreeSitterLanguage | null = null;
try { const mod = require('tree-sitter-java'); Java = mod; } catch { javaLanguageAvailable = false; }

function getJavaParser(): InstanceType<typeof Parser> {
  if (!javaLanguageAvailable || !Java) throw new Error('tree-sitter-java grammar unavailable (ABI mismatch or not installed)');
  if (!javaParser) { javaParser = new Parser(); javaParser.setLanguage(Java); }
  return javaParser;
}

function parseJavaSourceText(source: string): ParsedFile {
  try {
    const parser = getJavaParser();
    const tree = parser.parse(source);
    return {
      filePath: '<inline>',
      exports: extractJavaExports(tree.rootNode, source),
      imports: extractJavaImports(tree.rootNode, source),
      functions: extractJavaMethods(tree.rootNode, source),
      classes: extractJavaClasses(tree.rootNode, source),
      interfaces: extractJavaInterfaces(tree.rootNode, source),
      callGraph: [],
    };
  } catch (err) {
    return { filePath: '<inline>', exports: [], imports: [], functions: [], classes: [], interfaces: [], callGraph: [], error: (err as Error).message };
  }
}

function extractJavaExports(node: TreeSitterSyntaxNode, source: string): AstExport[] {
  const exports: AstExport[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'class_declaration') {
      const name = javaNodeName(n);
      const isPublic = javaHasModifier(n, 'public');
      if (name && isPublic) exports.push({ name, kind: 'class', signature: javaSignature(n, source), isDefault: false, line: n.startPosition.row + 1 });
    } else if (n.type === 'interface_declaration') {
      const name = javaNodeName(n);
      const isPublic = javaHasModifier(n, 'public');
      if (name && isPublic) exports.push({ name, kind: 'interface', signature: javaSignature(n, source), isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return exports;
}

function extractJavaImports(node: TreeSitterSyntaxNode, source: string): AstImport[] {
  const imports: AstImport[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'import_declaration') {
      let isWildcard = false;
      for (let i = 0; i < n.childCount; i++) {
        if (n.child(i)!.type === '*') isWildcard = true;
      }
      let sourcePath = '';
      for (const c of n.namedChildren) {
        if (c.type === 'scoped_identifier' || c.type === 'identifier') {
          sourcePath = c.text;
          break;
        }
      }
      if (sourcePath) {
        const parts = sourcePath.split('.');
        imports.push({ source: sourcePath, symbols: isWildcard ? ['*'] : [parts.pop() || sourcePath], defaultImport: null, namespaceImport: null, isTypeOnly: false, isExternal: true, line: n.startPosition.row + 1 });
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return imports;
}

function extractJavaMethods(node: TreeSitterSyntaxNode, source: string): AstFunction[] {
  const funcs: AstFunction[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'method_declaration' || n.type === 'constructor_declaration') {
      const name = javaNodeName(n) || '<init>';
      const params = javaExtractParams(n, source);
      const returnType = javaExtractReturnType(n, source);
      const isPublic = javaHasModifier(n, 'public');
      funcs.push({ name, params, returnType, isAsync: false, isExported: isPublic, isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return funcs;
}

function extractJavaClasses(node: TreeSitterSyntaxNode, source: string): AstClass[] {
  const classes: AstClass[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'class_declaration') {
      const name = javaNodeName(n) || '<anonymous>';
      const extendsName = javaExtractExtends(n, source);
      const implementsNames = javaExtractImplementsNames(n, source);
      const methods: AstFunction[] = [];
      const properties: string[] = [];
      const body = n.childForFieldName ? n.childForFieldName('body') : null;
      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'method_declaration' || child.type === 'constructor_declaration') {
            const mname = javaNodeName(child);
            if (mname) methods.push({ name: mname, params: javaExtractParams(child, source), returnType: javaExtractReturnType(child, source), isAsync: false, isExported: javaHasModifier(child, 'public'), isDefault: false, line: child.startPosition.row + 1 });
          } else if (child.type === 'field_declaration') {
            for (const decl of child.namedChildren) {
              if (decl.type === 'variable_declarator') {
                const fname = javaNodeName(decl);
                if (fname) properties.push(fname);
              }
            }
          }
        }
      }
      classes.push({ name, extends: extendsName, implements: implementsNames, methods, properties, isExported: javaHasModifier(n, 'public'), isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return classes;
}

function extractJavaInterfaces(node: TreeSitterSyntaxNode, source: string): AstInterface[] {
  const interfaces: AstInterface[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'interface_declaration') {
      const name = javaNodeName(n) || '<anonymous>';
      const ext: string[] = [];
      const members: string[] = [];
      for (const child of n.namedChildren) {
        if (child.type === 'extends_interfaces') {
          for (const c of child.namedChildren) {
            if (c.type === 'type_identifier') ext.push(c.text);
          }
        }
      }
      const body = n.childForFieldName ? n.childForFieldName('body') : null;
      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'method_declaration') {
            const mname = javaNodeName(child);
            if (mname) members.push(mname);
          }
        }
      }
      interfaces.push({ name, extends: ext, members, isExported: javaHasModifier(n, 'public'), line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return interfaces;
}

function javaNodeName(node: TreeSitterSyntaxNode): string | null {
  const nameNode = node.childForFieldName ? node.childForFieldName('name') : null;
  if (nameNode) return nameNode.text;
  for (const c of node.namedChildren) {
    if (c.type === 'identifier' || c.type === 'type_identifier') return c.text;
  }
  return null;
}

function javaHasModifier(node: TreeSitterSyntaxNode, modifier: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        if (child.child(j)?.text === modifier) return true;
      }
    }
    if (child?.text === modifier || child?.type === modifier) return true;
  }
  return false;
}

function javaSignature(node: TreeSitterSyntaxNode, source: string): string {
  const text = source.substring(node.startIndex, node.endIndex).split('\n')[0].trim();
  return text.length > 100 ? text.substring(0, 100) + '…' : text;
}

function javaExtractParams(node: TreeSitterSyntaxNode, source: string): string[] {
  const params: string[] = [];
  const formalParams = node.childForFieldName ? node.childForFieldName('parameters') : null;
  if (!formalParams) return params;
  for (const child of formalParams.namedChildren) {
    if (child.type === 'formal_parameter') params.push(source.substring(child.startIndex, child.endIndex).trim());
  }
  return params;
}

function javaExtractReturnType(node: TreeSitterSyntaxNode, source: string): string | null {
  if (node.type === 'constructor_declaration') return null;
  const type = node.childForFieldName ? node.childForFieldName('type') : null;
  if (!type) return null;
  return source.substring(type.startIndex, type.endIndex).trim();
}

function javaExtractExtends(node: TreeSitterSyntaxNode, source: string): string | null {
  const sup = node.childForFieldName ? node.childForFieldName('superclass') : null;
  if (sup) {
    const id = sup.namedChildren.find(c => c.type === 'type_identifier');
    return id?.text || source.substring(sup.startIndex, sup.endIndex).trim();
  }
  return null;
}

function javaExtractImplementsNames(node: TreeSitterSyntaxNode, source: string): string[] {
  const impls: string[] = [];
  const supInterfaces = node.childForFieldName ? node.childForFieldName('interfaces') : null;
  // tree-sitter-java uses 'super_interfaces' field name
  const interfaces = supInterfaces || (node.childForFieldName ? node.childForFieldName('super_interfaces') : null);
  if (interfaces) {
    for (const child of interfaces.namedChildren) {
      if (child.type === 'type_identifier') impls.push(child.text);
      else if (child.type === 'type_list') {
        for (const c of child.namedChildren) {
          if (c.type === 'type_identifier') impls.push(c.text);
        }
      }
    }
  }
  return impls;
}

// ============================================================
// Kotlin AST Parser (tree-sitter)
// ============================================================
let ktParser: InstanceType<typeof Parser> | null = null;
let ktLanguageAvailable = true;
let Kotlin: TreeSitterLanguage | null = null;
try { const mod = require('tree-sitter-kotlin'); Kotlin = mod; } catch { ktLanguageAvailable = false; }

function getKtParser(): InstanceType<typeof Parser> {
  if (!ktLanguageAvailable || !Kotlin) throw new Error('tree-sitter-kotlin grammar unavailable (ABI mismatch or not installed)');
  if (!ktParser) { ktParser = new Parser(); ktParser.setLanguage(Kotlin); }
  return ktParser;
}

function parseKotlinSourceText(source: string): ParsedFile {
  try {
    const parser = getKtParser();
    const tree = parser.parse(source);
    return {
      filePath: '<inline>',
      exports: extractKtExports(tree.rootNode, source),
      imports: extractKtImports(tree.rootNode, source),
      functions: extractKtFunctions(tree.rootNode, source),
      classes: extractKtClasses(tree.rootNode, source),
      interfaces: extractKtInterfaces(tree.rootNode, source),
      callGraph: [],
    };
  } catch (err) {
    return { filePath: '<inline>', exports: [], imports: [], functions: [], classes: [], interfaces: [], callGraph: [], error: (err as Error).message };
  }
}

function extractKtExports(node: TreeSitterSyntaxNode, source: string): AstExport[] {
  const exports: AstExport[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'function_declaration') {
      const name = ktNodeName(n);
      if (name) exports.push({ name, kind: 'function', signature: ktSignature(n, source), isDefault: false, line: n.startPosition.row + 1 });
    } else if (n.type === 'class_declaration') {
      const name = ktNodeName(n);
      if (name) exports.push({ name, kind: 'class', signature: ktSignature(n, source), isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return exports;
}

function extractKtImports(node: TreeSitterSyntaxNode, source: string): AstImport[] {
  const imports: AstImport[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'import_header') {
      let text = source.substring(n.startIndex, n.endIndex).replace(/^import\s+/, '').trim();
      const symbols: string[] = [];
      const parts = text.split('.');
      if (parts.length > 0) symbols.push(parts.pop() || text);
      imports.push({ source: text, symbols, defaultImport: null, namespaceImport: null, isTypeOnly: false, isExternal: true, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return imports;
}

function extractKtFunctions(node: TreeSitterSyntaxNode, source: string): AstFunction[] {
  const funcs: AstFunction[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'function_declaration') {
      const name = ktNodeName(n) || '<anonymous>';
      const params = ktExtractParams(n, source);
      const returnType = ktExtractReturnType(n, source);
      funcs.push({ name, params, returnType, isAsync: false, isExported: true, isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return funcs;
}

function extractKtClasses(node: TreeSitterSyntaxNode, source: string): AstClass[] {
  const classes: AstClass[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'class_declaration') {
      const name = ktNodeName(n) || '<anonymous>';
      const methods: AstFunction[] = [];
      const body = n.childForFieldName ? n.childForFieldName('body') : null;
      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'function_declaration') {
            const mname = ktNodeName(child);
            if (mname) methods.push({ name: mname, params: ktExtractParams(child, source), returnType: ktExtractReturnType(child, source), isAsync: false, isExported: true, isDefault: false, line: child.startPosition.row + 1 });
          }
        }
      }
      classes.push({ name, extends: null, implements: [], methods, properties: [], isExported: true, isDefault: false, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return classes;
}

function extractKtInterfaces(node: TreeSitterSyntaxNode, source: string): AstInterface[] {
  const interfaces: AstInterface[] = [];
  function walk(n: TreeSitterSyntaxNode) {
    if (n.type === 'interface_declaration') {
      const name = ktNodeName(n) || '<anonymous>';
      const members: string[] = [];
      const body = n.childForFieldName ? n.childForFieldName('body') : null;
      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'function_declaration') {
            const mname = ktNodeName(child);
            if (mname) members.push(mname);
          }
        }
      }
      interfaces.push({ name, extends: [], members, isExported: true, line: n.startPosition.row + 1 });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return interfaces;
}

function ktNodeName(node: TreeSitterSyntaxNode): string | null {
  const nameNode = node.childForFieldName ? node.childForFieldName('name') : null;
  if (nameNode) {
    if (nameNode.type === 'simple_identifier') return nameNode.text;
    const inner = nameNode.namedChildren[0];
    if (inner && (inner.type === 'simple_identifier' || inner.type === 'type_identifier')) return inner.text;
    return nameNode.text;
  }
  for (const c of node.namedChildren) {
    if (c.type === 'simple_identifier' || c.type === 'type_identifier') return c.text;
  }
  return null;
}

function ktSignature(node: TreeSitterSyntaxNode, source: string): string {
  const text = source.substring(node.startIndex, node.endIndex).split('\n')[0].trim();
  return text.length > 100 ? text.substring(0, 100) + '…' : text;
}

function ktExtractParams(node: TreeSitterSyntaxNode, source: string): string[] {
  const params: string[] = [];
  const paramList = node.childForFieldName ? node.childForFieldName('parameters') : null;
  if (!paramList) return params;
  for (const child of paramList.namedChildren) {
    if (child.type === 'parameter' || child.type === 'function_value_parameters') {
      for (const c of child.namedChildren) {
        if (c.type === 'parameter') params.push(source.substring(c.startIndex, c.endIndex).trim());
      }
    }
    if (child.type !== 'parameter' && child.type !== 'function_value_parameters') {
      params.push(source.substring(child.startIndex, child.endIndex).trim());
    }
  }
  if (params.length === 0) {
    for (const child of paramList.namedChildren) {
      params.push(source.substring(child.startIndex, child.endIndex).trim());
    }
  }
  return params;
}

function ktExtractReturnType(node: TreeSitterSyntaxNode, source: string): string | null {
  const type = node.childForFieldName ? node.childForFieldName('type') : null;
  if (!type) return null;
  return source.substring(type.startIndex, type.endIndex).replace(/^:\s*/, '').trim();
}

// ============================================================
// Swift / ObjC / SQL — Regex-based parsers
// ============================================================
function parseRegexBased(source: string, language: 'swift' | 'objc' | 'sql'): ParsedFile {
  const errors: string[] = [];
  try {
    switch (language) {
      case 'swift': return parseSwiftRegex(source);
      case 'objc': return parseObjcRegex(source);
      case 'sql': return parseSqlRegex(source);
    }
  } catch (err) {
    return { filePath: '<inline>', exports: [], imports: [], functions: [], classes: [], interfaces: [], callGraph: [], error: (err as Error).message };
  }
}

// Swift regex patterns
function parseSwiftRegex(source: string): ParsedFile {
  const exports: AstExport[] = [];
  const imports: AstImport[] = [];
  const funcs: AstFunction[] = [];
  const classes: AstClass[] = [];
  const interfaces: AstInterface[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // import Module
    let m = line.match(/^import\s+(\w+)/);
    if (m) { imports.push({ source: m[1], symbols: [m[1]], defaultImport: null, namespaceImport: null, isTypeOnly: false, isExternal: true, line: lineNum }); continue; }

    // func name(...) -> Type
    m = line.match(/^(?:public\s+|private\s+|internal\s+|open\s+|override\s+)*func\s+(\w+)\s*\(/);
    if (m) {
      const name = m[1];
      const params = swiftExtractParams(line, source, i, lines);
      const returnType = line.match(/->\s*(\S+)/)?.[1] || null;
      const isPublic = /^\s*(public|open)\s/.test(line);
      exports.push({ name, kind: 'function', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      funcs.push({ name, params, returnType, isAsync: line.includes('async'), isExported: isPublic, isDefault: false, line: lineNum });
      continue;
    }

    // class/struct/enum name
    m = line.match(/^(?:public\s+|private\s+|internal\s+|open\s+)*(class|struct|enum)\s+(\w+)/);
    if (m) {
      const name = m[2]; const kind = m[1] === 'class' ? 'class' as const : 'class' as const;
      const isPublic = /^\s*(public|open)\s/.test(line);
      const extendsMatch = line.match(/:\s*(\w+)/);
      exports.push({ name, kind, signature: line.substring(0, 100), isDefault: false, line: lineNum });
      classes.push({ name, extends: extendsMatch?.[1] || null, implements: [], methods: [], properties: [], isExported: isPublic, isDefault: false, line: lineNum });
      continue;
    }

    // protocol name
    m = line.match(/^(?:public\s+)*protocol\s+(\w+)/);
    if (m) {
      const name = m[1];
      exports.push({ name, kind: 'interface', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      interfaces.push({ name, extends: [], members: [], isExported: true, line: lineNum });
    }
  }

  return { filePath: '<inline>', exports, imports, functions: funcs, classes, interfaces, callGraph: [] };
}

function swiftExtractParams(line: string, source: string, lineIdx: number, lines: string[]): string[] {
  const params: string[] = [];
  const joined = lines.slice(lineIdx).join(' ');
  const parenStart = joined.indexOf('(');
  const parenEnd = joined.indexOf(')');
  if (parenStart >= 0 && parenEnd > parenStart) {
    const paramStr = joined.substring(parenStart + 1, parenEnd);
    // Split by comma, handle labels like "name: Type" or "_ name: Type"
    for (const part of paramStr.split(',')) {
      const trimmed = part.trim();
      if (trimmed) params.push(trimmed);
    }
  }
  return params;
}

// ObjC regex patterns
function parseObjcRegex(source: string): ParsedFile {
  const exports: AstExport[] = [];
  const imports: AstImport[] = [];
  const funcs: AstFunction[] = [];
  const classes: AstClass[] = [];
  const interfaces: AstInterface[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // #import <Module/Header.h> or #import "Header.h"
    let m = line.match(/^#import\s+[<"]([^>"]+)[>"]/);
    if (m) { imports.push({ source: m[1], symbols: [m[1].split('/').pop()?.replace('.h', '') || m[1]], defaultImport: null, namespaceImport: null, isTypeOnly: false, isExternal: true, line: lineNum }); continue; }

    // @interface ClassName : ParentClass
    m = line.match(/^@interface\s+(\w+)\s*(:\s*(\w+))?/);
    if (m) {
      const name = m[1]; const parentCls = m[3] || null;
      exports.push({ name, kind: 'class', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      classes.push({ name, extends: parentCls, implements: [], methods: [], properties: [], isExported: true, isDefault: false, line: lineNum });
      continue;
    }

    // @implementation ClassName
    m = line.match(/^@implementation\s+(\w+)/);
    if (m) {
      exports.push({ name: m[1], kind: 'class', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      continue;
    }

    // @protocol ProtocolName
    m = line.match(/^@protocol\s+(\w+)/);
    if (m) {
      exports.push({ name: m[1], kind: 'interface', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      interfaces.push({ name: m[1], extends: [], members: [], isExported: true, line: lineNum });
      continue;
    }

    // - (Type)methodName or + (Type)methodName
    m = line.match(/^[-+]\s*\(([^)]*)\)\s*(\w+)/);
    if (m) {
      const name = m[2]; const returnType = m[1] || null;
      exports.push({ name, kind: 'function', signature: line.substring(0, 100), isDefault: false, line: lineNum });
      funcs.push({ name, params: objcExtractParams(line, source, i, lines), returnType, isAsync: false, isExported: true, isDefault: false, line: lineNum });
    }
  }

  return { filePath: '<inline>', exports, imports, functions: funcs, classes, interfaces, callGraph: [] };
}

function objcExtractParams(line: string, source: string, lineIdx: number, lines: string[]): string[] {
  const params: string[] = [];
  const colonParts = line.split(':');
  for (let j = 1; j < colonParts.length; j++) {
    const part = colonParts[j].trim();
    const m = part.match(/^\(([^)]*)\)\s*(\w+)/);
    if (m) params.push(`${m[2]}: ${m[1]}`);
  }
  return params;
}

// SQL/MySQL regex patterns
function parseSqlRegex(source: string): ParsedFile {
  const exports: AstExport[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;
    const upper = line.toUpperCase();

    // CREATE TABLE name
    let m = line.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/i);
    if (m) { exports.push({ name: m[1], kind: 'class', signature: line.substring(0, 100), isDefault: false, line: lineNum }); continue; }

    // CREATE PROCEDURE / FUNCTION name
    m = line.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION)\s+(\w+)/i);
    if (m) { exports.push({ name: m[2], kind: 'function', signature: line.substring(0, 100), isDefault: false, line: lineNum }); continue; }

    // CREATE VIEW name
    m = line.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)/i);
    if (m) { exports.push({ name: m[1], kind: 'unknown', signature: line.substring(0, 100), isDefault: false, line: lineNum }); continue; }

    // CREATE INDEX name
    m = line.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(\w+)/i);
    if (m) { exports.push({ name: m[1], kind: 'unknown', signature: line.substring(0, 100), isDefault: false, line: lineNum }); }
  }

  return { filePath: '<inline>', exports, imports: [], functions: [], classes: [], interfaces: [], callGraph: [] };
}

// ============================================================
// Multi-language dispatch
// ============================================================
const GO_EXTS = new Set(['.go']);
const PY_EXTS = new Set(['.py', '.pyw', '.pyi']);
const JAVA_EXTS = new Set(['.java']);
const KT_EXTS = new Set(['.kt', '.kts']);
const SWIFT_EXTS = new Set(['.swift']);
const OBJC_EXTS = new Set(['.m', '.mm', '.h']);
const SQL_EXTS = new Set(['.sql', '.mysql', '.psql']);
const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

type TreeSitterSyntaxNode = import('tree-sitter').SyntaxNode;

// Multi-language dispatch for parseSourceFile
export function parseSourceFile(filePath: string): Promise<ParsedFile> {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  if (GO_EXTS.has(ext)) return parseGoSourceFile(filePath);
  if (PY_EXTS.has(ext)) return parsePythonSourceFile(filePath);
  if (JAVA_EXTS.has(ext)) return toPromise(parseJavaSourceFile(filePath));
  if (KT_EXTS.has(ext)) return toPromise(parseKotlinSourceFile(filePath));
  if (SWIFT_EXTS.has(ext)) return toPromise(parseSwiftSourceFile(filePath));
  if (OBJC_EXTS.has(ext)) return toPromise(parseObjcSourceFile(filePath));
  if (SQL_EXTS.has(ext)) return toPromise(parseSqlSourceFile(filePath));
  return parseTsSourceFile(filePath);
}

export function parseSourceText(source: string, options?: { language?: 'typescript' | 'go' | 'python' | 'java' | 'kotlin' | 'swift' | 'objc' | 'sql'; isTsx?: boolean }): ParsedFile {
  const lang = options?.language;
  if (lang === 'go') return parseGoSourceText(source);
  if (lang === 'python') return parsePythonSourceText(source);
  if (lang === 'java') return parseJavaSourceText(source);
  if (lang === 'kotlin') return parseKotlinSourceText(source);
  if (lang === 'swift') return parseSwiftRegex(source);
  if (lang === 'objc') return parseObjcRegex(source);
  if (lang === 'sql') return parseSqlRegex(source);
  return parseTsSourceText(source, options?.isTsx);
}

// Async wrappers for regex-based parsers (file-backed)
async function parseJavaSourceFile(filePath: string): Promise<ParsedFile> {
  const source = await readFile(filePath, 'utf-8');
  const result = parseJavaSourceText(source);
  return { ...result, filePath, error: undefined };
}
async function parseKotlinSourceFile(filePath: string): Promise<ParsedFile> {
  const source = await readFile(filePath, 'utf-8');
  const result = parseKotlinSourceText(source);
  return { ...result, filePath, error: undefined };
}
async function parseSwiftSourceFile(filePath: string): Promise<ParsedFile> {
  const source = await readFile(filePath, 'utf-8');
  const result = parseSwiftRegex(source);
  return { ...result, filePath, error: undefined };
}
async function parseObjcSourceFile(filePath: string): Promise<ParsedFile> {
  const source = await readFile(filePath, 'utf-8');
  const result = parseObjcRegex(source);
  return { ...result, filePath, error: undefined };
}
async function parseSqlSourceFile(filePath: string): Promise<ParsedFile> {
  const source = await readFile(filePath, 'utf-8');
  const result = parseSqlRegex(source);
  return { ...result, filePath, error: undefined };
}

async function toPromise<T>(promise: Promise<T>): Promise<T> { return promise; }
// iCloser mock edit: 测试Agent桥接
