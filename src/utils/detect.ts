// Project auto-detection: language, framework, database, build system
import * as path from 'path';
import fse from 'fs-extra';
import type {
  LanguageType, FrameworkType, DatabaseType, BuildSystem,
  TestFramework, ProjectIdentity,
} from '../types.js';

export async function detectProject(rootPath: string): Promise<ProjectIdentity> {
  const files = await listAllFiles(rootPath);
  const packageJson = await readJsonFile(rootPath, 'package.json');
  const goMod = await readGoMod(rootPath);
  const cargoToml = await readCargoToml(rootPath);
  const requirements = await readRequirements(rootPath);
  const pyproject = await fileContent(rootPath, 'pyproject.toml'); // Read as text, not JSON
  const composer = await readJsonFile(rootPath, 'composer.json');
  const gemfile = await fileContent(rootPath, 'Gemfile');
  const buildGradle = await fileContent(rootPath, 'build.gradle') || await fileContent(rootPath, 'build.gradle.kts');
  const pomXml = await fileContent(rootPath, 'pom.xml');

  // Count actual source-code files (not config, docs, data)
  const codeFiles = files.filter(f => /\.(tsx?|jsx?|go|rs|py|java|kt|kts|cs|php|rb|swift|c|cpp|cc|cxx|m|mm)$/i.test(f));
  const docFiles = files.filter(f => /\.(md|txt|rst|adoc)$/i.test(f) || /\b(README|LICENSE|CHANGELOG|CONTRIBUTING)\b/i.test(f));
  const configFiles = files.filter(f => /\.(ya?ml|toml|ini|cfg|conf|json)$/i.test(f));
  const dataFiles = files.filter(f => /\.(csv|tsv|jsonl|xml|sql|parquet|avro)$/i.test(f));
  const iacFiles = files.filter(f => /\.(tf|hcl)$/i.test(f) || /\b(Dockerfile|docker-compose|ansible|playbook|helm|Chart\.yaml)\b/i.test(f));

  let language = detectLanguage(files, { packageJson, goMod, cargoToml, requirements, pyproject, composer, gemfile, buildGradle, pomXml });

  // If no code language detected, classify by file type composition
  if (language === 'unknown') {
    language = classifyProjectType(files, codeFiles, docFiles, configFiles, iacFiles, dataFiles);
  }

  let framework = detectFramework(files, language, packageJson, goMod, requirements, buildGradle, pomXml);
  let database = detectDatabase(files, packageJson, goMod, requirements, pyproject, buildGradle, pomXml);

  // Post-process: if subprojects reveal a stronger backend identity, adjust root identity
  try {
    const subs = await detectSubprojects(rootPath);
    // Find the subproject with the most code files (strongest signal)
    const rankedSubs = subs
      .filter(s => ['Java', 'Kotlin', 'Go', 'Rust', 'Python', 'CSharp', 'TypeScript'].includes(s.language))
      .sort((a, b) => (b.path || '').length - (a.path || '').length);
    const backendSub = rankedSubs.find(s =>
      ['Java', 'Kotlin', 'Go', 'Rust', 'Python', 'CSharp'].includes(s.language)
    );
    if (backendSub && ['typescript', 'javascript', 'unknown', 'documentation', 'config', 'objc', 'swift', 'c', 'cpp', 'php', 'ruby'].includes(language)) {
      const backendLang = backendSub.language.toLowerCase() as LanguageType;
      language = backendLang;
      framework = (backendSub.framework as FrameworkType) || framework;
    }
    // Also inherit database from subproject when root detection was wrong
    if (['postgresql', 'unknown'].includes(database)) {
      const subWithDb = subs.find(s =>
        s.name.includes('server') || s.name.includes('backend') || s.buildFile === 'pom.xml'
      );
      if (subWithDb && subWithDb.buildFile === 'pom.xml' && pomXml) {
        const pomLower = pomXml.toLowerCase();
        if (pomLower.includes('mysql')) database = 'mysql';
        else if (pomLower.includes('postgresql')) database = 'postgresql';
      }
    }
  } catch { /* subproject detection is best-effort */ }

  // Compute remaining fields AFTER potential language override from subprojects
  const testFramework = detectTestFramework(files, packageJson, goMod, requirements, buildGradle);
  const buildSystem = detectBuildSystem(files, language, packageJson);
  const runtime = detectRuntime(language, packageJson, goMod, pyproject);
  const deploymentType = detectDeploymentType(files, language);
  const languageVersion = detectLanguageVersion(language, packageJson, goMod, cargoToml, pyproject);

  // Compute detection confidence
  const hasBuildFile = !!(packageJson || goMod || cargoToml || pomXml || buildGradle || requirements || composer || gemfile);
  const hasCode = codeFiles.length > 0;
  const detectionConfidence: 'high' | 'medium' | 'low' =
    (hasBuildFile && hasCode) ? 'high' :
    (hasCode) ? 'medium' : 'low';

  return {
    language,
    framework,
    database,
    buildSystem,
    testFramework,
    runtime,
    deploymentType,
    packageManager: detectPackageManager(files, packageJson),
    languageVersion,
    detectionConfidence,
  };
}

// ============================================================
// Language Detection
// ============================================================
function detectLanguage(
  files: string[],
  indicators: Record<string, unknown>
): LanguageType {
  const { packageJson, goMod, cargoToml, requirements, pyproject, composer, gemfile, buildGradle, pomXml } = indicators as Record<string, unknown>;

  // Score-based detection
  const scores: Record<LanguageType, number> = {
    typescript: 0, javascript: 0, go: 0, rust: 0, python: 0,
    java: 0, kotlin: 0, csharp: 0, php: 0, ruby: 0,
    swift: 0, objc: 0, c: 0, cpp: 0,
    documentation: 0, config: 0, data: 0, infrastructure: 0, empty: 0,
    unknown: 0,
  };

  // TypeScript indicators
  if (files.includes('tsconfig.json')) scores.typescript += 10;
  if (files.some(f => f.endsWith('.ts') || f.endsWith('.tsx'))) scores.typescript += 5;
  if (packageJson && (packageJson as Record<string, unknown>).devDependencies) {
    const devDeps = (packageJson as Record<string, Record<string, string>>).devDependencies || {};
    if ('typescript' in devDeps) scores.typescript += 5;
  }

  // JavaScript indicators
  if (files.some(f => f.endsWith('.js') || f.endsWith('.jsx'))) scores.javascript += 5;
  if (packageJson && !files.includes('tsconfig.json')) scores.javascript += 5;

  // Go indicators
  if (goMod) scores.go += 15;
  if (files.some(f => f.endsWith('.go'))) scores.go += 5;

  // Rust indicators
  if (cargoToml) scores.rust += 15;
  if (files.some(f => f.endsWith('.rs'))) scores.rust += 5;

  // Python indicators
  if (requirements) scores.python += 8;
  if (pyproject) scores.python += 5;
  if (files.includes('setup.py') || files.includes('setup.cfg')) scores.python += 5;
  if (files.some(f => f.endsWith('.py'))) scores.python += 4;

  // Java indicators
  if (pomXml) scores.java += 10;
  if (buildGradle) scores.java += 5;
  if (files.some(f => f.endsWith('.java'))) scores.java += 5;

  // Kotlin indicators
  if (files.some(f => f.endsWith('.kt') || f.endsWith('.kts'))) scores.kotlin += 10;

  // C# indicators — .csproj alone insufficient without .cs files
  if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln')) && files.some(f => f.endsWith('.cs'))) scores.csharp += 15;
  if (files.some(f => f.endsWith('.cs'))) scores.csharp += 5;

  // PHP indicators
  if (composer) scores.php += 15;
  if (files.some(f => f.endsWith('.php'))) scores.php += 5;

  // Ruby indicators — Gemfile double-counting fix: only count fileContent result
  if (gemfile) scores.ruby += 15;
  if (files.some(f => f.endsWith('.rb'))) scores.ruby += 5;

  // Swift indicators
  if (files.some(f => f.endsWith('.swift'))) scores.swift += 15;
  if (files.some(f => f.includes('.xcodeproj') || f.includes('.xcworkspace'))) scores.swift += 10;
  if (files.some(f => f === 'Podfile' || f === 'Package.swift')) scores.swift += 5;

  // Objective-C indicators
  if (files.some(f => f.endsWith('.m') || f.endsWith('.mm'))) scores.objc += 15;
  if (files.some(f => f.includes('.xcodeproj') || f.includes('.xcworkspace')) && !files.some(f => f.endsWith('.swift'))) scores.objc += 5;
  // .h files are ambiguous (C/C++/ObjC headers), skip to avoid false positives

  // C/C++ indicators
  if (files.some(f => f.endsWith('.c'))) scores.c += 10;
  if (files.some(f => f.endsWith('.cpp') || f.endsWith('.cc') || f.endsWith('.cxx'))) scores.cpp += 10;
  if (files.includes('CMakeLists.txt')) { scores.c += 5; scores.cpp += 5; }

  // IaC indicators — file-based, not requiring the iacFiles variable from outer scope
  const hasIaC = files.filter(f => /\.(tf|hcl)$/i.test(f) || /\b(Dockerfile|docker-compose)\b/i.test(f)).length;
  if (hasIaC >= 2) scores.infrastructure += 5;

  // Find highest scoring language
  let best: LanguageType = 'unknown';
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = lang as LanguageType;
    }
  }

  // Threshold: 8 (was 3, too low — a single .py file or package.json is not a project)
  return bestScore >= 8 ? best : 'unknown';
}

/** Classify the project type based on file composition (no code files → non-code category) */
function classifyProjectType(
  files: string[], codeFiles: string[],
  docFiles: string[], configFiles: string[], iacFiles: string[], dataFiles: string[]
): LanguageType {
  const total = files.length;
  if (total === 0) return 'empty';
  if (codeFiles.length > 0) return 'unknown'; // has code — let detectLanguage decide
  if (iacFiles.length >= 2 || (iacFiles.length >= 1 && total <= 10)) return 'infrastructure';
  if (docFiles.length / total > 0.6) return 'documentation';
  if (dataFiles.length / total > 0.6) return 'data';
  if (configFiles.length / total > 0.6) return 'config';
  if (docFiles.length / total > 0.3) return 'documentation';
  return 'unknown';
}

// ============================================================
// Framework Detection
// ============================================================
function detectFramework(
  files: string[],
  language: LanguageType,
  packageJson: Record<string, unknown> | null,
  goMod: string | null,
  requirements: string | null,
  buildGradle: string | null,
  pomXml: string | null
): FrameworkType {
  const deps = packageJson ? {
    ...((packageJson.dependencies || {}) as Record<string, string>),
    ...((packageJson.devDependencies || {}) as Record<string, string>),
  } : {};

  // JavaScript/TypeScript frameworks
  if ('next' in deps) return 'nextjs';
  if ('nuxt' in deps) return 'nuxt';
  if ('react' in deps || 'react-dom' in deps) return 'react';
  if ('vue' in deps || files.some(f => f.endsWith('.vue'))) return 'vue';
  if ('svelte' in deps) return 'svelte';
  if ('@angular/core' in deps) return 'angular';
  if ('express' in deps) return 'express';
  if ('@nestjs/core' in deps) return 'nestjs';

  // Python frameworks
  if (requirements) {
    const reqs = requirements.toLowerCase();
    if (reqs.includes('django')) return 'django';
    if (reqs.includes('flask')) return 'flask';
    if (reqs.includes('fastapi')) return 'fastapi';
  }

  // Go frameworks
  if (goMod) {
    const mod = goMod.toLowerCase();
    if (mod.includes('gin-gonic/gin')) return 'gin';
    if (mod.includes('labstack/echo')) return 'unknown'; // Go Echo — no matching FrameworkType
  }

  // Non-code project types — framework is not applicable
  if (['documentation', 'config', 'data', 'infrastructure', 'empty'].includes(language)) return 'unknown';

  // iOS / Swift frameworks
  if (language === 'swift') {
    // Check file paths for framework indicators
    if (files.some(f => /swiftui/i.test(f) || /SwiftUI/i.test(f))) return 'swiftui';
    if (files.some(f => /uikit/i.test(f) || /UIKit/i.test(f) || /UIViewController/i.test(f))) return 'uikit';
    if (files.some(f => f.includes('.storyboard') || f.includes('.xib'))) return 'uikit';
    // Modern Swift projects (2019+) default to SwiftUI
    if (files.some(f => f.includes('.xcodeproj') || f.includes('.xcworkspace'))) return 'swiftui';
    return 'swiftui'; // default for Swift
  }

  // iOS / ObjC frameworks
  if (language === 'objc' || files.some(f => f.endsWith('.m') || f.endsWith('.mm'))) {
    return 'uikit';
  }

  // Java frameworks
  if (buildGradle || pomXml) {
    const content = (buildGradle || pomXml || '').toLowerCase();
    if (content.includes('spring-boot')) return 'spring-boot';
  }

  // PHP
  if (files.includes('artisan')) return 'laravel';

  // Ruby
  if (files.some(f => f.includes('rails'))) return 'rails';

  return 'unknown';
}

// ============================================================
// Database Detection
// ============================================================
function detectDatabase(
  files: string[],
  packageJson: Record<string, unknown> | null,
  goMod: string | null,
  requirements: string | null,
  _pyproject: string | null,
  buildGradle: string | null,
  pomXml: string | null,
): DatabaseType {
  const allText = files.join(' ').toLowerCase();

  // Config file path detection
  if (allText.includes('postgres') || allText.includes('psql') || files.some(f => f.includes('pg'))) return 'postgresql';
  if (allText.includes('mysql') || files.some(f => f.includes('mysql'))) return 'mysql';
  if (files.some(f => f === 'db.sqlite3' || f.endsWith('.sqlite') || f.endsWith('.db'))) return 'sqlite';
  if (allText.includes('mongodb') || allText.includes('mongoose')) return 'mongodb';
  if (allText.includes('redis')) return 'redis';
  if (allText.includes('elasticsearch')) return 'elasticsearch';
  if (allText.includes('dynamodb')) return 'dynamodb';

  // Java/Maven MySQL detection via pom.xml content
  const pomLower = (pomXml || '').toLowerCase();
  const gradleLower = (buildGradle || '').toLowerCase();
  const javaBuildText = pomLower + gradleLower;
  if (javaBuildText.includes('mysql-connector') || javaBuildText.includes('com.mysql')) return 'mysql';
  if (javaBuildText.includes('postgresql') || javaBuildText.includes('org.postgresql')) return 'postgresql';
  if (javaBuildText.includes('mongo') || javaBuildText.includes('mongodb')) return 'mongodb';
  if (javaBuildText.includes('redis') || javaBuildText.includes('jedis') || javaBuildText.includes('lettuce')) return 'redis';
  if (javaBuildText.includes('oracle') || javaBuildText.includes('ojdbc')) return 'unknown'; // Oracle not in DatabaseType union
  // Spring Boot JPA/Hibernate implies a database is used
  if (javaBuildText.includes('spring-boot-starter-data-jpa') || javaBuildText.includes('hibernate')) {
    if (javaBuildText.includes('h2')) return 'unknown'; // H2 not in DatabaseType union
    if (pomLower.includes('mysql') || gradleLower.includes('mysql')) return 'mysql';
    if (pomLower.includes('postgres') || gradleLower.includes('postgres')) return 'postgresql';
  }

  // Package dependency detection
  const deps = packageJson ? {
    ...((packageJson.dependencies || {}) as Record<string, string>),
    ...((packageJson.devDependencies || {}) as Record<string, string>),
  } : {};

  if ('pg' in deps || 'postgres' in deps || 'prisma' in deps) return 'postgresql';
  if ('mysql2' in deps || 'mysql' in deps) return 'mysql';
  if ('better-sqlite3' in deps || 'sqlite3' in deps) return 'sqlite';
  if ('mongoose' in deps || 'mongodb' in deps) return 'mongodb';
  if ('ioredis' in deps || 'redis' in deps) return 'redis';

  if (goMod) {
    const mod = goMod.toLowerCase();
    if (mod.includes('lib/pq') || mod.includes('pgx')) return 'postgresql';
    if (mod.includes('go-sql-driver/mysql')) return 'mysql';
    if (mod.includes('mongo-driver')) return 'mongodb';
    if (mod.includes('go-redis')) return 'redis';
  }

  if (requirements) {
    const reqs = requirements.toLowerCase();
    if (reqs.includes('psycopg')) return 'postgresql';
    if (reqs.includes('pymysql') || reqs.includes('mysqlclient')) return 'mysql';
    if (reqs.includes('pymongo') || reqs.includes('mongoengine')) return 'mongodb';
    if (reqs.includes('redis')) return 'redis';
  }

  // iOS database detection
  if (files.some(f => f.includes('.xcdatamodeld') || f.includes('CoreData'))) return 'sqlite'; // CoreData uses SQLite
  const hasRealm = files.some(f => f.includes('Realm') || f.includes('realm'));
  const javaRealm = javaBuildText.includes('realm');
  if (hasRealm || javaRealm) return 'mongodb'; // Realm is NoSQL-like

  // Migration folder detection
  if (files.some(f => f.includes('migration') || f.includes('migrate'))) {
    if (files.some(f => f.includes('.sql'))) return 'postgresql'; // best guess
  }

  return 'unknown';
}

// ============================================================
// Build System Detection
// ============================================================
function detectBuildSystem(
  files: string[],
  _language: LanguageType,
  _packageJson: Record<string, unknown> | null
): BuildSystem {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('package-lock.json') || files.includes('package.json')) return 'npm';
  if (files.includes('Cargo.toml') || files.includes('Cargo.lock')) return 'cargo';
  if (files.includes('go.mod') || files.includes('go.sum')) return 'go-mod';
  if (files.includes('build.gradle') || files.includes('build.gradle.kts')) return 'gradle';
  if (files.includes('pom.xml')) return 'maven';
  if (files.includes('requirements.txt') || files.includes('setup.py')) return 'pip';
  if (files.includes('poetry.lock') || files.includes('pyproject.toml')) return 'poetry';
  // iOS build systems
  if (files.some(f => f.includes('.xcodeproj') || f.includes('.xcworkspace'))) return 'xcode';
  if (files.includes('Podfile')) return 'cocoapods';
  if (files.includes('Package.swift')) return 'spm';
  if (files.includes('Cartfile')) return 'carthage';

  return 'unknown';
}

// ============================================================
// Test Framework Detection
// ============================================================
function detectTestFramework(
  files: string[],
  packageJson: Record<string, unknown> | null,
  goMod: string | null,
  requirements: string | null,
  buildGradle: string | null
): TestFramework {
  const deps = packageJson ? {
    ...((packageJson.dependencies || {}) as Record<string, string>),
    ...((packageJson.devDependencies || {}) as Record<string, string>),
  } : {};

  if ('vitest' in deps) return 'vitest';
  if ('jest' in deps) return 'jest';
  if ('cypress' in deps) return 'cypress';
  if ('@playwright/test' in deps || 'playwright' in deps) return 'playwright';

  if (goMod && files.some(f => f.endsWith('_test.go'))) return 'go-test';

  if (requirements) {
    const reqs = requirements.toLowerCase();
    if (reqs.includes('pytest')) return 'pytest';
  }

  if (buildGradle || files.some(f => f.endsWith('Test.java'))) return 'junit';

  // iOS test frameworks
  if (files.some(f => f.includes('XCTest') || f.endsWith('Tests.swift') || f.endsWith('Test.swift'))) return 'xctest';

  return 'unknown';
}

// ============================================================
// Deployment Detection
// ============================================================
function detectDeploymentType(files: string[], language: LanguageType): ProjectIdentity['deploymentType'] {
  if (files.some(f => f.includes('k8s') || f.includes('kubernetes') || f.endsWith('.k8s.yaml'))) return 'kubernetes';
  if (files.includes('Dockerfile') || files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) return 'docker';
  if (files.some(f => f.includes('serverless.yml') || f.includes('serverless'))) return 'serverless';
  if (files.some(f => f.includes('microservice'))) return 'microservices';
  if (files.some(f => f.includes('.xcodeproj') || f.includes('.xcworkspace') || f.includes('Info.plist'))) return 'ios-app';
  if (language === 'infrastructure') return 'docker'; // IaC repos default to Docker-ish deployment
  return 'unknown';
}

// ============================================================
// Runtime Detection
// ============================================================
function detectRuntime(
  language: LanguageType,
  packageJson: Record<string, unknown> | null,
  _goMod: string | null,
  _pyproject: string | null
): string {
  if (language === 'typescript' || language === 'javascript') {
    if (packageJson && (packageJson as Record<string, unknown>).engines) {
      return (packageJson as Record<string, Record<string, string>>).engines?.node || 'Node.js';
    }
    return 'Node.js';
  }
  if (language === 'go') return 'Go Native';
  if (language === 'rust') return 'Rust Native';
  if (language === 'python') return 'CPython';
  if (language === 'java' || language === 'kotlin') return 'JVM';
  if (language === 'swift' || language === 'objc') return 'Apple Swift/ObjC';
  if (language === 'c' || language === 'cpp') return 'Native';
  if (language === 'csharp') return '.NET CLR';
  if (language === 'php') return 'PHP Zend Engine';
  if (language === 'ruby') return 'Ruby MRI';
  if (language === 'infrastructure') return 'Container/Docker';
  if (['documentation', 'config', 'data', 'empty'].includes(language)) return 'N/A';
  return 'unknown';
}

// ============================================================
// Version Detection
// ============================================================
function detectLanguageVersion(
  language: LanguageType,
  packageJson: Record<string, unknown> | null,
  goMod: string | null,
  cargoToml: string | null,
  pyproject: string | null
): string {
  if (language === 'go' && goMod) {
    const match = goMod.match(/^go\s+(\S+)/m);
    if (match) return match[1];
  }
  if (language === 'rust' && cargoToml) {
    const match = cargoToml.match(/edition\s*=\s*"(\S+)"/);
    if (match) return match[1];
  }
  if (language === 'python' && pyproject) {
    // TOML: requires-python = ">=3.9"
    const match = pyproject.match(/requires-python\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }
  return 'unknown';
}

// ============================================================
// Package Manager
// ============================================================
function detectPackageManager(
  files: string[],
  packageJson: Record<string, unknown> | null
): string {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (packageJson) return 'npm';
  if (files.includes('Cargo.toml')) return 'cargo';
  if (files.includes('go.mod')) return 'go-mod';
  if (files.includes('pom.xml')) return 'maven';
  if (files.includes('build.gradle') || files.includes('build.gradle.kts')) return 'gradle';
  if (files.includes('pyproject.toml')) return 'poetry';
  if (files.includes('requirements.txt')) return 'pip';
  // iOS build systems
  if (files.some(f => f.includes('.xcodeproj') || f.includes('.xcworkspace'))) return 'xcode';
  if (files.includes('Podfile')) return 'cocoapods';
  if (files.includes('Package.swift') && !files.includes('Podfile')) return 'spm';
  if (files.includes('Cartfile')) return 'carthage';
  return 'none';
}

// ============================================================
// Helpers
// ============================================================
async function listAllFiles(rootPath: string): Promise<string[]> {
  const result: string[] = [];
  const SKIP_DIRS = new Set(['node_modules', 'vendor', '__pycache__', '.git', '.icloser', 'dist', 'build', '.next', '.nuxt', 'target', 'bin', 'obj']);
  const MAX_FILES = 3000;

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (result.length >= MAX_FILES || depth > 5) return;
    try {
      const entries = await fse.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (result.length >= MAX_FILES) return;
        if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.github') continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const relPath = path.relative(rootPath, path.join(dirPath, entry.name)).replace(/\\/g, '/');
        if (entry.isFile()) {
          result.push(relPath);
        } else if (entry.isDirectory()) {
          result.push(relPath);
          if (depth < 5) await walk(path.join(dirPath, entry.name), depth + 1);
        }
      }
    } catch { /* best effort */ }
  }

  await walk(rootPath, 0);
  return result;
}

async function readJsonFile(rootPath: string, filename: string): Promise<Record<string, unknown> | null> {
  // Try root, then common subdirectories
  const searchPaths = [rootPath];
  try {
    const entries = await fse.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'vendor') {
        searchPaths.push(path.join(rootPath, entry.name));
      }
    }
  } catch { /* keep root only */ }

  for (const dir of searchPaths) {
    try {
      const content = await fse.readFile(path.join(dir, filename), 'utf-8');
      if (filename.endsWith('.json')) return JSON.parse(content);
      return null; // Non-JSON files (TOML/XML/etc.) — callers handle null
    } catch { /* continue */ }
  }
  return null;
}

async function readGoMod(rootPath: string): Promise<string | null> {
  // Try root, then platform/, server/, backend/, src/, app/
  const dirs = ['', 'platform', 'server', 'backend', 'src', 'app', 'cmd'];
  for (const dir of dirs) {
    try {
      const p = dir ? path.join(rootPath, dir, 'go.mod') : path.join(rootPath, 'go.mod');
      return await fse.readFile(p, 'utf-8');
    } catch { /* continue */ }
  }
  return null;
}

async function readCargoToml(rootPath: string): Promise<string | null> {
  const dirs = ['', 'rust', 'backend', 'server'];
  for (const dir of dirs) {
    try {
      const p = dir ? path.join(rootPath, dir, 'Cargo.toml') : path.join(rootPath, 'Cargo.toml');
      return await fse.readFile(p, 'utf-8');
    } catch { /* continue */ }
  }
  return null;
}

async function readRequirements(rootPath: string): Promise<string | null> {
  const dirs = ['', 'python', 'backend', 'server', 'api'];
  for (const dir of dirs) {
    try {
      const p = dir ? path.join(rootPath, dir, 'requirements.txt') : path.join(rootPath, 'requirements.txt');
      return await fse.readFile(p, 'utf-8');
    } catch { /* continue */ }
  }
  return null;
}

async function fileContent(rootPath: string, filename: string): Promise<string | null> {
  // Try root, then one level of subdirectories
  try {
    return await fse.readFile(path.join(rootPath, filename), 'utf-8');
  } catch { /* try subdirs */ }
  try {
    const entries = await fse.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      try {
        return await fse.readFile(path.join(rootPath, entry.name, filename), 'utf-8');
      } catch { /* continue */ }
    }
  } catch { /* ignore */ }
  return null;
}

// ── P3-1: Monorepo subdirectory discovery ──
export interface Subproject {
  name: string;
  path: string;        // relative to root
  language: string;
  framework?: string;
  buildFile: string;   // e.g. "package.json", "pom.xml", "go.mod"
  startCommand?: string;
  port?: number;       // detected from config
}

/** Scan depth-2 subdirectories for nested project indicators */
export async function detectSubprojects(rootPath: string): Promise<Subproject[]> {
  const subs: Subproject[] = [];
  try {
    const entries = await fse.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const subPath = path.join(rootPath, entry.name);
      const subName = entry.name;

      // Check level 1
      await checkDir(subPath, subName, subs);

      // Check level 2 (monorepo packages/*)
      try {
        const subEntries = await fse.readdir(subPath, { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (!subEntry.isDirectory() || subEntry.name.startsWith('.')) continue;
          const sub2Path = path.join(subPath, subEntry.name);
          await checkDir(sub2Path, `${subName}/${subEntry.name}`, subs);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return subs;
}

async function checkDir(dirPath: string, name: string, subs: Subproject[]): Promise<void> {
  const files = await safeReaddir(dirPath);
  const fileSet = new Set(files);

  if (fileSet.has('package.json')) {
    let framework: string | undefined;
    try {
      const pkg = await fse.readJson(path.join(dirPath, 'package.json'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) framework = 'Next.js';
      else if (deps.react) framework = 'React';
      else if (deps.vue) framework = 'Vue';
      else if (deps.express) framework = 'Express';
      else if (deps['@nestjs/core']) framework = 'NestJS';
      if (pkg.scripts?.dev) {
        subs.push({ name, path: name, language: 'TypeScript', framework, buildFile: 'package.json', startCommand: 'npm run dev' });
      } else if (pkg.scripts?.start) {
        subs.push({ name, path: name, language: 'TypeScript', framework, buildFile: 'package.json', startCommand: 'npm start' });
      } else {
        subs.push({ name, path: name, language: 'TypeScript', framework, buildFile: 'package.json' });
      }
    } catch {
      subs.push({ name, path: name, language: 'TypeScript', buildFile: 'package.json' });
    }
    return;
  }

  if (fileSet.has('pom.xml')) {
    let port: number | undefined;
    try {
      const content = await fse.readFile(path.join(dirPath, 'pom.xml'), 'utf-8');
      const portM = content.match(/server\.port[=:]\s*(\d+)/);
      if (portM) port = parseInt(portM[1]);
    } catch { /* skip */ }
    const hasWrapper = fileSet.has('mvnw') || fileSet.has('mvnw.cmd');
    subs.push({
      name, path: name, language: 'Java', framework: 'Spring Boot',
      buildFile: 'pom.xml',
      startCommand: hasWrapper ? './mvnw spring-boot:run' : 'mvn spring-boot:run',
      port: port || 8080,
    });
    return;
  }

  if (fileSet.has('build.gradle') || fileSet.has('build.gradle.kts')) {
    const hasWrapper = fileSet.has('gradlew') || fileSet.has('gradlew.bat');
    subs.push({
      name, path: name, language: 'Java', framework: 'Gradle',
      buildFile: 'build.gradle',
      startCommand: hasWrapper ? './gradlew bootRun' : 'gradle bootRun',
      port: 8080,
    });
    return;
  }

  if (fileSet.has('go.mod')) {
    subs.push({
      name, path: name, language: 'Go',
      buildFile: 'go.mod',
      startCommand: 'go run .',
    });
    return;
  }

  if (fileSet.has('Cargo.toml')) {
    subs.push({
      name, path: name, language: 'Rust',
      buildFile: 'Cargo.toml',
      startCommand: 'cargo run',
    });
    return;
  }

  if (fileSet.has('Makefile')) {
    subs.push({
      name, path: name, language: 'unknown',
      buildFile: 'Makefile',
      startCommand: 'make',
    });
    return;
  }

  if (fileSet.has('requirements.txt') || fileSet.has('pyproject.toml') || fileSet.has('setup.py')) {
    subs.push({
      name, path: name, language: 'Python',
      buildFile: fileSet.has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt',
      startCommand: 'python -m uvicorn main:app --reload',
    });
  }
}

async function safeReaddir(dirPath: string): Promise<string[]> {
  try { return await fse.readdir(dirPath); } catch { return []; }
}

// ── P3-3: Non-Node dependency checking ──
export interface DepCheckResult {
  ok: boolean;
  language: string;
  message: string;
  toolMissing?: string;
}

export async function checkDependencies(
  rootPath: string,
  identity: { language: string },
): Promise<DepCheckResult> {
  const lang = identity.language?.toLowerCase() || '';

  if (lang === 'java') {
    // Check for Maven/Gradle wrapper
    const hasMvnw = await fse.pathExists(path.join(rootPath, 'mvnw')) || await fse.pathExists(path.join(rootPath, 'mvnw.cmd'));
    const hasGradlew = await fse.pathExists(path.join(rootPath, 'gradlew')) || await fse.pathExists(path.join(rootPath, 'gradlew.bat'));
    const hasPom = await fse.pathExists(path.join(rootPath, 'pom.xml'));
    const hasGradle = await fse.pathExists(path.join(rootPath, 'build.gradle')) || await fse.pathExists(path.join(rootPath, 'build.gradle.kts'));

    if (hasPom && !hasMvnw) {
      // Check if mvn is globally available
      const mvnInstalled = await commandExists('mvn --version');
      if (!mvnInstalled) {
        return { ok: false, language: 'Java/Maven', message: 'Maven 未安装且项目无 mvnw wrapper', toolMissing: 'mvn' };
      }
    }
    if (hasGradle && !hasGradlew) {
      const gradleInstalled = await commandExists('gradle --version');
      if (!gradleInstalled) {
        return { ok: false, language: 'Java/Gradle', message: 'Gradle 未安装且项目无 gradlew wrapper', toolMissing: 'gradle' };
      }
    }
    return { ok: true, language: 'Java', message: 'Java 依赖检查通过' };
  }

  if (lang === 'go') {
    const hasGoSum = await fse.pathExists(path.join(rootPath, 'go.sum'));
    if (!hasGoSum) {
      return { ok: false, language: 'Go', message: 'go.sum 不存在，请运行 go mod tidy', toolMissing: 'go' };
    }
    const goInstalled = await commandExists('go version');
    if (!goInstalled) {
      return { ok: false, language: 'Go', message: 'Go 未安装', toolMissing: 'go' };
    }
    return { ok: true, language: 'Go', message: 'Go 依赖检查通过' };
  }

  if (lang === 'python') {
    const hasRequirements = await fse.pathExists(path.join(rootPath, 'requirements.txt'));
    const hasPyproject = await fse.pathExists(path.join(rootPath, 'pyproject.toml'));
    if (!hasRequirements && !hasPyproject) {
      return { ok: true, language: 'Python', message: '无依赖文件' }; // not an error
    }
    const pythonInstalled = await commandExists('python --version') || await commandExists('python3 --version');
    if (!pythonInstalled) {
      return { ok: false, language: 'Python', message: 'Python 未安装', toolMissing: 'python' };
    }
    return { ok: true, language: 'Python', message: 'Python 依赖检查通过' };
  }

  if (lang === 'rust') {
    const cargoInstalled = await commandExists('cargo --version');
    if (!cargoInstalled) {
      return { ok: false, language: 'Rust', message: 'Cargo 未安装', toolMissing: 'cargo' };
    }
    const hasLock = await fse.pathExists(path.join(rootPath, 'Cargo.lock'));
    if (!hasLock) {
      return { ok: true, language: 'Rust', message: 'Cargo.lock 不存在（首次构建时生成）' };
    }
    return { ok: true, language: 'Rust', message: 'Rust 依赖检查通过' };
  }

  // TypeScript/JavaScript — already handled by node_modules check elsewhere
  return { ok: true, language: lang, message: '依赖检查通过' };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    // Use lightweight 'where'/'which' instead of running the actual command
    // (avoids side effects like Maven plugin downloads or Gradle daemon startup)
    const checker = process.platform === 'win32'
      ? `where ${cmd.split(' ')[0]}`
      : `which ${cmd.split(' ')[0]}`;
    execSync(checker, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
