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
  const pyproject = await readJsonFile(rootPath, 'pyproject.toml');
  const composer = await readJsonFile(rootPath, 'composer.json');
  const gemfile = await fileContent(rootPath, 'Gemfile');
  const buildGradle = await fileContent(rootPath, 'build.gradle') || await fileContent(rootPath, 'build.gradle.kts');
  const pomXml = await fileContent(rootPath, 'pom.xml');

  const language = detectLanguage(files, { packageJson, goMod, cargoToml, requirements, pyproject, composer, gemfile, buildGradle, pomXml });
  const framework = detectFramework(files, language, packageJson, goMod, requirements, buildGradle, pomXml);
  const database = detectDatabase(files, packageJson, goMod, requirements, pyproject, buildGradle, pomXml);
  const buildSystem = detectBuildSystem(files, language, packageJson);
  const testFramework = detectTestFramework(files, packageJson, goMod, requirements, buildGradle);
  const deploymentType = detectDeploymentType(files);
  const runtime = detectRuntime(language, packageJson, goMod, pyproject);
  const languageVersion = detectLanguageVersion(language, packageJson, goMod, cargoToml, pyproject);

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
    swift: 0, c: 0, cpp: 0, unknown: 0,
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

  // C# indicators
  if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln'))) scores.csharp += 15;
  if (files.some(f => f.endsWith('.cs'))) scores.csharp += 5;

  // PHP indicators
  if (composer) scores.php += 15;
  if (files.some(f => f.endsWith('.php'))) scores.php += 5;

  // Ruby indicators
  if (gemfile) scores.ruby += 15;
  if (files.includes('Gemfile')) scores.ruby += 10;
  if (files.some(f => f.endsWith('.rb'))) scores.ruby += 5;

  // Swift indicators
  if (files.some(f => f.endsWith('.swift'))) scores.swift += 15;
  if (files.some(f => f.includes('.xcodeproj') || f.includes('.xcworkspace'))) scores.swift += 10;
  if (files.some(f => f === 'Podfile' || f === 'Package.swift')) scores.swift += 5;

  // Objective-C indicators (often alongside Swift in iOS projects)
  if (files.some(f => f.endsWith('.m') || f.endsWith('.mm') || f.endsWith('.h'))) scores.swift += 3;

  // C/C++ indicators
  if (files.some(f => f.endsWith('.c'))) scores.c += 10;
  if (files.some(f => f.endsWith('.cpp') || f.endsWith('.cc') || f.endsWith('.cxx'))) scores.cpp += 10;
  if (files.includes('CMakeLists.txt') || files.includes('Makefile')) {
    scores.c += 3;
    scores.cpp += 3;
  }

  // Find highest scoring language
  let best: LanguageType = 'unknown';
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = lang as LanguageType;
    }
  }

  return bestScore > 3 ? best : 'unknown';
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
    if (mod.includes('labstack/echo')) return 'express'; // closest match
  }

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
  if (files.some(f => f.endsWith('.m') || f.endsWith('.mm'))) {
    // ObjC is always UIKit era
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
  pyproject: Record<string, unknown> | null,
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
  if (javaBuildText.includes('oracle') || javaBuildText.includes('ojdbc')) return 'postgresql'; // best match
  // Spring Boot JPA/Hibernate implies a database is used
  if (javaBuildText.includes('spring-boot-starter-data-jpa') || javaBuildText.includes('hibernate')) {
    if (javaBuildText.includes('h2')) return 'postgresql'; // best match for embedded
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
  language: LanguageType,
  packageJson: Record<string, unknown> | null
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
function detectDeploymentType(files: string[]): ProjectIdentity['deploymentType'] {
  if (files.some(f => f.includes('k8s') || f.includes('kubernetes') || f.endsWith('.k8s.yaml'))) return 'kubernetes';
  if (files.includes('Dockerfile') || files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) return 'docker';
  if (files.some(f => f.includes('serverless.yml') || f.includes('serverless'))) return 'serverless';
  if (files.some(f => f.includes('microservice'))) return 'microservices';
  // iOS deployment
  if (files.some(f => f.includes('.xcodeproj') || f.includes('.xcworkspace') || f.includes('Info.plist'))) return 'ios-app';
  return 'unknown';
}

// ============================================================
// Runtime Detection
// ============================================================
function detectRuntime(
  language: LanguageType,
  packageJson: Record<string, unknown> | null,
  goMod: string | null,
  pyproject: Record<string, unknown> | null
): string {
  if (language === 'typescript' || language === 'javascript') {
    if (packageJson && (packageJson as Record<string, unknown>).engines) {
      return (packageJson as Record<string, Record<string, string>>).engines?.node || 'Node.js';
    }
    // detect deno/bun
    return 'Node.js';
  }
  if (language === 'go') return 'Go Native';
  if (language === 'rust') return 'Rust Native';
  if (language === 'python') return 'CPython';
  if (language === 'java' || language === 'kotlin') return 'JVM';
  return 'Unknown';
}

// ============================================================
// Version Detection
// ============================================================
function detectLanguageVersion(
  language: LanguageType,
  packageJson: Record<string, unknown> | null,
  goMod: string | null,
  cargoToml: string | null,
  pyproject: Record<string, unknown> | null
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
    const requires = (pyproject as Record<string, Record<string, string>>)?.project?.['requires-python'];
    if (requires) return requires;
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
      return content as unknown as Record<string, unknown>;
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
