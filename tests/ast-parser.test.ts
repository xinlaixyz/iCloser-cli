import { describe, expect, it } from 'vitest';
import { parseSourceText } from '../src/core/ast-parser.js';

describe('AST parser — exports', () => {
  it('extracts named function exports', () => {
    const result = parseSourceText('export function add(a: number, b: number): number { return a + b; }');
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]).toMatchObject({ name: 'add', kind: 'function', isDefault: false });
    expect(result.exports[0].signature).toContain('function add');
  });

  it('extracts named class exports', () => {
    const result = parseSourceText('export class Counter { private count = 0; increment() { this.count++; } }');
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]).toMatchObject({ name: 'Counter', kind: 'class', isDefault: false });
  });

  it('extracts interface exports', () => {
    const result = parseSourceText('export interface User { id: string; email: string; }');
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]).toMatchObject({ name: 'User', kind: 'interface' });
  });

  it('extracts type alias exports', () => {
    const result = parseSourceText('export type Status = "active" | "inactive";');
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]).toMatchObject({ name: 'Status', kind: 'type' });
  });

  it('extracts const exports', () => {
    const result = parseSourceText('export const API_URL = "https://api.example.com";');
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]).toMatchObject({ name: 'API_URL', kind: 'const' });
  });

  it('extracts default export', () => {
    const result = parseSourceText('export default function setup() { return 42; }');
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]).toMatchObject({ name: 'setup', kind: 'function', isDefault: true });
  });

  it('extracts named re-exports', () => {
    const result = parseSourceText('export { LoginForm, RegisterForm }');
    expect(result.exports).toHaveLength(2);
    expect(result.exports.map(e => e.name).sort()).toEqual(['LoginForm', 'RegisterForm'].sort());
  });
});

describe('AST parser — imports', () => {
  it('extracts named imports with symbols', () => {
    const result = parseSourceText('import { useState, useEffect } from "react";');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toMatchObject({ source: 'react', isExternal: true });
    expect(result.imports[0].symbols).toContain('useState');
    expect(result.imports[0].symbols).toContain('useEffect');
  });

  it('extracts default import', () => {
    const result = parseSourceText('import React from "react";');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].defaultImport).toBe('React');
  });

  it('extracts namespace import', () => {
    const result = parseSourceText('import * as utils from "./utils";');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].namespaceImport).toBe('utils');
    expect(result.imports[0].isExternal).toBe(false);
  });

  it('extracts type-only import', () => {
    const result = parseSourceText('import type { User } from "./types";');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].isTypeOnly).toBe(true);
    expect(result.imports[0].source).toBe('./types');
  });

  it('handles combined default + named import', () => {
    const result = parseSourceText('import React, { useState } from "react";');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].defaultImport).toBe('React');
    expect(result.imports[0].symbols).toContain('useState');
  });
});

describe('AST parser — functions', () => {
  it('extracts function declarations with params', () => {
    const result = parseSourceText('function greet(name: string): string { return "Hello " + name; }');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]).toMatchObject({ name: 'greet', returnType: 'string' });
    expect(result.functions[0].params.length).toBe(1);
    expect(result.functions[0].params[0]).toContain('name');
  });

  it('marks async functions', () => {
    const result = parseSourceText('export async function fetchData(url: string): Promise<Response> { return fetch(url); }');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].isAsync).toBe(true);
  });

  it('detects exported functions', () => {
    const result = parseSourceText('export function publicApi() {} function internal() {}');
    const publicFn = result.functions.find(f => f.name === 'publicApi');
    const internalFn = result.functions.find(f => f.name === 'internal');
    expect(publicFn?.isExported).toBe(true);
    expect(internalFn?.isExported).toBe(false);
  });
});

describe('AST parser — classes', () => {
  it('extracts class with extends and methods', () => {
    const result = parseSourceText(`
export class Dog extends Animal {
  bark(): void { console.log("woof"); }
  fetch(item: string): boolean { return true; }
}`);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]).toMatchObject({ name: 'Dog', extends: 'Animal' });
    expect(result.classes[0].methods.length).toBe(2);
    expect(result.classes[0].methods[0].name).toBe('bark');
  });

  it('extracts class with implements', () => {
    const result = parseSourceText('class Service implements ILogger, IDisposable { log() {} }');
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].implements).toContain('ILogger');
    expect(result.classes[0].implements).toContain('IDisposable');
  });
});

describe('AST parser — interfaces', () => {
  it('extracts interface with extends', () => {
    const result = parseSourceText('export interface Admin extends User { permissions: string[]; }');
    expect(result.interfaces).toHaveLength(1);
    expect(result.interfaces[0]).toMatchObject({ name: 'Admin' });
    expect(result.interfaces[0].extends).toContain('User');
  });

  it('extracts interface members', () => {
    const result = parseSourceText('interface Config { baseUrl: string; timeout: number; getHeaders(): Record<string, string>; }');
    expect(result.interfaces).toHaveLength(1);
    expect(result.interfaces[0].members).toContain('baseUrl');
    expect(result.interfaces[0].members).toContain('timeout');
    expect(result.interfaces[0].members).toContain('getHeaders');
  });
});

describe('AST parser — call graph', () => {
  it('tracks function calls within functions', () => {
    const result = parseSourceText(`
function init() { setup(); render(); }
function setup() { console.log("setup"); }
function render() {}
`);
    const initCalls = result.callGraph.filter(e => e.caller === 'init');
    expect(initCalls.length).toBeGreaterThanOrEqual(2);
    expect(initCalls.map(c => c.callee)).toContain('setup');
    expect(initCalls.map(c => c.callee)).toContain('render');
  });

  it('tracks method calls', () => {
    const result = parseSourceText('const x = path.join("a", "b");');
    const joinCalls = result.callGraph.filter(e => e.callee === 'path.join');
    expect(joinCalls.length).toBe(1);
  });
});

describe('AST parser — error handling', () => {
  it('returns empty arrays for invalid syntax', () => {
    const result = parseSourceText('this is not valid typescript @@@');
    expect(result.error).toBeDefined();
    expect(result.exports).toEqual([]);
    expect(result.imports).toEqual([]);
  });

  it('handles empty file', () => {
    const result = parseSourceText('');
    expect(result.error).toBeUndefined();
    expect(result.exports).toEqual([]);
  });

  it('handles TSX syntax', () => {
    const result = parseSourceText(
      'export const Button = ({ label }: { label: string }) => <button>{label}</button>;',
      { isTsx: true }
    );
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]).toMatchObject({ name: 'Button', kind: 'const' });
  });
});

// ============================================================
// Go AST Parser (S9)
// ============================================================
const goAvailable = (() => {
  try { const r = parseSourceText('package main', { language: 'go' }); return !r.error; } catch { return false; }
})();

const goIt = goAvailable ? it : it.skip;
const goDescribe = goAvailable ? describe : describe.skip;

goDescribe('AST parser — Go', () => {
  goIt('extracts exported function declarations', () => {
    const result = parseSourceText('package main\n\nfunc Add(a int, b int) int {\n\treturn a + b\n}\n', { language: 'go' });
    expect(result.error).toBeUndefined();
    expect(result.functions.length).toBeGreaterThanOrEqual(1);
    const add = result.functions.find(f => f.name === 'Add')!;
    expect(add).toBeDefined();
    expect(add.params.length).toBeGreaterThanOrEqual(1);
    expect(add.returnType).toBe('int');
    expect(add.isExported).toBe(true);
  });

  goIt('marks unexported functions as not exported', () => {
    const result = parseSourceText('package main\n\nfunc helper() string {\n\treturn "ok"\n}\n', { language: 'go' });
    const helper = result.functions.find(f => f.name === 'helper')!;
    expect(helper).toBeDefined();
    expect(helper.isExported).toBe(false);
  });

  goIt('extracts exported methods', () => {
    const result = parseSourceText('package main\n\ntype Counter struct {\n\tcount int\n}\n\nfunc (c *Counter) Increment() int {\n\tc.count++\n\treturn c.count\n}\n', { language: 'go' });
    const inc = result.functions.find(f => f.name === 'Increment')!;
    expect(inc).toBeDefined();
    expect(inc.isExported).toBe(true);
    expect(inc.returnType).toBe('int');
  });

  goIt('extracts struct type exports', () => {
    const result = parseSourceText('package main\n\ntype User struct {\n\tName string\n\tAge int\n}\n', { language: 'go' });
    expect(result.exports.length).toBeGreaterThanOrEqual(1);
    const user = result.exports.find(e => e.name === 'User')!;
    expect(user).toBeDefined();
  });

  goIt('extracts interface type exports', () => {
    const result = parseSourceText('package main\n\ntype Reader interface {\n\tRead(p []byte) (n int, err error)\n}\n', { language: 'go' });
    const reader = result.exports.find(e => e.name === 'Reader')!;
    expect(reader).toBeDefined();
    expect(reader.kind).toBe('interface');
    expect(result.interfaces.length).toBeGreaterThanOrEqual(1);
  });

  goIt('extracts import statements', () => {
    const result = parseSourceText('package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n', { language: 'go' });
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    const sources = result.imports.map(i => i.source);
    expect(sources).toContain('fmt');
    expect(sources).toContain('os');
  });

  goIt('tracks call graph', () => {
    const result = parseSourceText('package main\n\nfunc helper() int { return 1 }\n\nfunc Main() int {\n\treturn helper()\n}\n', { language: 'go' });
    const call = result.callGraph.find(e => e.callee === 'helper')!;
    expect(call).toBeDefined();
    expect(call.caller).toBe('Main');
  });

  goIt('handles empty Go source', () => {
    const result = parseSourceText('package main\n', { language: 'go' });
    expect(result.error).toBeUndefined();
  });
});

// ============================================================
// Python AST Parser (S9)
// ============================================================
const pyAvailable = (() => {
  try { const r = parseSourceText('', { language: 'python' }); return !r.error; } catch { return false; }
})();
const pyIt = pyAvailable ? it : it.skip;
const pyDescribe = pyAvailable ? describe : describe.skip;

pyDescribe('AST parser — Python', () => {
  pyIt('extracts function definitions', () => {
    const result = parseSourceText('def add(a, b):\n    return a + b\n', { language: 'python' });
    expect(result.error).toBeUndefined();
    expect(result.functions.length).toBeGreaterThanOrEqual(1);
    const add = result.functions.find(f => f.name === 'add')!;
    expect(add).toBeDefined();
    expect(add.params).toContain('a');
    expect(add.params).toContain('b');
  });

  pyIt('extracts function with type annotations', () => {
    const result = parseSourceText('def greet(name: str) -> str:\n    return f"Hello {name}"\n', { language: 'python' });
    const greet = result.functions.find(f => f.name === 'greet')!;
    expect(greet).toBeDefined();
    expect(greet.returnType).toBe('str');
  });

  pyIt('extracts async functions', () => {
    const result = parseSourceText('async def fetch(url: str) -> dict:\n    return {}\n', { language: 'python' });
    const fetch = result.functions.find(f => f.name === 'fetch')!;
    expect(fetch).toBeDefined();
    expect(fetch.isAsync).toBe(true);
  });

  pyIt('extracts class definitions with methods', () => {
    const result = parseSourceText(
      'class Counter:\n    def __init__(self, start=0):\n        self.count = start\n    def increment(self):\n        self.count += 1\n        return self.count\n',
      { language: 'python' }
    );
    expect(result.classes.length).toBeGreaterThanOrEqual(1);
    const counter = result.classes[0];
    expect(counter.name).toBe('Counter');
    expect(counter.methods.length).toBeGreaterThanOrEqual(2);
    const methodNames = counter.methods.map(m => m.name);
    expect(methodNames).toContain('__init__');
    expect(methodNames).toContain('increment');
  });

  pyIt('extracts class with inheritance', () => {
    const result = parseSourceText('class Dog(Animal):\n    def bark(self):\n        pass\n', { language: 'python' });
    expect(result.classes.length).toBeGreaterThanOrEqual(1);
    expect(result.classes[0].extends).toBe('Animal');
  });

  pyIt('extracts exports (top-level functions and classes)', () => {
    const result = parseSourceText(
      'def helper():\n    pass\n\nclass Config:\n    pass\n',
      { language: 'python' }
    );
    expect(result.exports.length).toBeGreaterThanOrEqual(2);
    const names = result.exports.map(e => e.name);
    expect(names).toContain('helper');
    expect(names).toContain('Config');
  });

  pyIt('extracts import statements', () => {
    const result = parseSourceText('import os\nfrom pathlib import Path\n', { language: 'python' });
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    const sources = result.imports.map(i => i.source);
    expect(sources.some(s => s.includes('os'))).toBe(true);
    expect(sources.some(s => s.includes('pathlib'))).toBe(true);
  });

  pyIt('handles empty Python source', () => {
    const result = parseSourceText('', { language: 'python' });
    expect(result.error).toBeUndefined();
  });
});

// ============================================================
// Java AST Parser (tree-sitter)
// ============================================================
const javaAvailable = (() => {
  try { const r = parseSourceText('class A{}', { language: 'java' }); return !r.error; } catch { return false; }
})();
const javaIt = javaAvailable ? it : it.skip;
const javaDescribe = javaAvailable ? describe : describe.skip;

javaDescribe('AST parser — Java', () => {
  javaIt('extracts public class exports', () => {
    const result = parseSourceText('public class UserService {\n  public String getName() { return "ok"; }\n}', { language: 'java' });
    expect(result.error).toBeUndefined();
    expect(result.exports.length).toBeGreaterThanOrEqual(1);
    const svc = result.exports.find(e => e.name === 'UserService')!;
    expect(svc).toBeDefined();
    expect(svc.kind).toBe('class');
  });

  javaIt('extracts public methods', () => {
    const result = parseSourceText('public class Calc {\n  public int add(int a, int b) { return a + b; }\n}', { language: 'java' });
    const add = result.functions.find(f => f.name === 'add')!;
    expect(add).toBeDefined();
    expect(add.isExported).toBe(true);
  });

  javaIt('extracts interfaces', () => {
    const result = parseSourceText('public interface Repository<T> {\n  T findById(long id);\n}', { language: 'java' });
    const repo = result.exports.find(e => e.name === 'Repository')!;
    expect(repo).toBeDefined();
    expect(repo.kind).toBe('interface');
  });

  javaIt('extracts import statements', () => {
    const result = parseSourceText('import java.util.List;\nimport java.sql.*;\n\npublic class App {}', { language: 'java' });
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });

  javaIt('extracts class with extends and implements', () => {
    const result = parseSourceText('public class Dog extends Animal implements Pet {\n  public void bark() {}\n}', { language: 'java' });
    expect(result.classes.length).toBeGreaterThanOrEqual(1);
    expect(result.classes[0].extends).toBe('Animal');
    expect(result.classes[0].implements).toContain('Pet');
  });
});

// ============================================================
// Kotlin AST Parser (tree-sitter)
// ============================================================
const ktAvailable = (() => {
  try { const r = parseSourceText('fun main(){}', { language: 'kotlin' }); return !r.error; } catch { return false; }
})();
const ktIt = ktAvailable ? it : it.skip;
const ktDescribe = ktAvailable ? describe : describe.skip;

ktDescribe('AST parser — Kotlin', () => {
  ktIt('extracts function declarations', () => {
    const result = parseSourceText('fun greet(name: String): String {\n    return "Hello $name"\n}', { language: 'kotlin' });
    expect(result.error).toBeUndefined();
    const greet = result.functions.find(f => f.name === 'greet')!;
    expect(greet).toBeDefined();
  });

  ktIt('extracts class declarations', () => {
    const result = parseSourceText('class User(val id: Long, val name: String) {\n    fun display() {}\n}', { language: 'kotlin' });
    const user = result.exports.find(e => e.name === 'User')!;
    expect(user).toBeDefined();
    expect(user.kind).toBe('class');
  });

  ktIt('extracts import statements', () => {
    const result = parseSourceText('import kotlinx.coroutines.*\nimport java.util.Date\n\nfun main() {}', { language: 'kotlin' });
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Swift Parser (regex-based)
// ============================================================
describe('AST parser — Swift', () => {
  it('extracts function declarations', () => {
    const result = parseSourceText('func greet(name: String) -> String {\n    return "Hello \\(name)"\n}', { language: 'swift' });
    expect(result.error).toBeUndefined();
    const greet = result.functions.find(f => f.name === 'greet')!;
    expect(greet).toBeDefined();
    expect(greet.returnType).toBe('String');
  });

  it('extracts class declarations with inheritance', () => {
    const result = parseSourceText('class Dog: Animal {\n    func bark() {}\n}', { language: 'swift' });
    const dog = result.classes.find(c => c.name === 'Dog')!;
    expect(dog).toBeDefined();
    expect(dog.extends).toBe('Animal');
  });

  it('extracts protocol declarations', () => {
    const result = parseSourceText('protocol Identifiable {\n    var id: String { get }\n}', { language: 'swift' });
    const proto = result.interfaces.find(i => i.name === 'Identifiable')!;
    expect(proto).toBeDefined();
  });

  it('extracts import statements', () => {
    const result = parseSourceText('import Foundation\nimport UIKit\n\nfunc app() {}', { language: 'swift' });
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    expect(result.imports.map(i => i.source)).toContain('Foundation');
  });
});

// ============================================================
// ObjC Parser (regex-based)
// ============================================================
describe('AST parser — ObjC', () => {
  it('extracts @interface class declarations', () => {
    const result = parseSourceText('@interface UserService : NSObject\n- (NSString *)getUserName:(NSInteger)userId;\n@end', { language: 'objc' });
    expect(result.error).toBeUndefined();
    const svc = result.exports.find(e => e.name === 'UserService')!;
    expect(svc).toBeDefined();
  });

  it('extracts method declarations', () => {
    const result = parseSourceText('@implementation Calc\n- (int)add:(int)a to:(int)b {\n    return a + b;\n}\n@end', { language: 'objc' });
    const add = result.functions.find(f => f.name === 'add')!;
    expect(add).toBeDefined();
  });

  it('extracts @protocol declarations', () => {
    const result = parseSourceText('@protocol DataSource\n- (NSArray *)fetchAll;\n@end', { language: 'objc' });
    const proto = result.interfaces.find(i => i.name === 'DataSource')!;
    expect(proto).toBeDefined();
  });

  it('extracts #import statements', () => {
    const result = parseSourceText('#import <Foundation/Foundation.h>\n#import "MyClass.h"\n\n@implementation App\n@end', { language: 'objc' });
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// SQL/MySQL Parser (regex-based)
// ============================================================
describe('AST parser — SQL', () => {
  it('extracts CREATE TABLE statements', () => {
    const result = parseSourceText('CREATE TABLE users (\n  id INT PRIMARY KEY,\n  name VARCHAR(100)\n);', { language: 'sql' });
    expect(result.error).toBeUndefined();
    const users = result.exports.find(e => e.name === 'users')!;
    expect(users).toBeDefined();
    expect(users.kind).toBe('class');
  });

  it('extracts CREATE PROCEDURE statements', () => {
    const result = parseSourceText('CREATE PROCEDURE sp_get_users()\nBEGIN\n  SELECT * FROM users;\nEND', { language: 'sql' });
    const sp = result.exports.find(e => e.name === 'sp_get_users')!;
    expect(sp).toBeDefined();
    expect(sp.kind).toBe('function');
  });

  it('extracts CREATE VIEW statements', () => {
    const result = parseSourceText('CREATE VIEW active_users AS SELECT * FROM users WHERE status = 1;', { language: 'sql' });
    const view = result.exports.find(e => e.name === 'active_users')!;
    expect(view).toBeDefined();
  });

  it('extracts CREATE FUNCTION statements', () => {
    const result = parseSourceText('CREATE FUNCTION calc_total(price DECIMAL, qty INT) RETURNS DECIMAL\nBEGIN\n  RETURN price * qty;\nEND', { language: 'sql' });
    const fn = result.exports.find(e => e.name === 'calc_total')!;
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
  });

  it('handles MySQL IF NOT EXISTS syntax', () => {
    const result = parseSourceText('CREATE TABLE IF NOT EXISTS orders (\n  id INT AUTO_INCREMENT PRIMARY KEY\n);', { language: 'sql' });
    const orders = result.exports.find(e => e.name === 'orders')!;
    expect(orders).toBeDefined();
  });
});
