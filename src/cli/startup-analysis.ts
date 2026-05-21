// AI-powered startup analysis — reads config files, asks AI to understand
// the project before offering to start it. Returns enriched analysis or null
// (best-effort; falls back to raw detection on failure).

import type { AIProviderAdapter } from '../ai/provider.js';
import type { SubProjectInfo } from './startup.js';

export interface StartupServiceAnalysis {
  dir: string;
  verifiedCommand: string;
  isServer: boolean;
  port?: number;
  dependencies: string[];
  warnings: string[];
  prerequisites: string[];
}

export interface StartupAnalysis {
  services: StartupServiceAnalysis[];
  suggestedOrder: string[];
  overallWarnings: string[];
  confidence: 'low' | 'medium' | 'high';
}

const AI_TIMEOUT_MS = 12_000;
const CONFIG_MAX = 2000;
const SCRIPTS_MAX = 1000;
const README_MAX = 1500;
const ENV_MAX = 800;
const DOCKERFILE_MAX = 1500;

// ============================================================
// Config file reading
// ============================================================

interface ProjectConfigs {
  dir: string;
  type: string;
  command: string;
  args: string[];
  makefile?: string;
  packageScripts?: string;
  readme?: string;
  envExample?: string;
  dockerfile?: string;
}

async function readConfigs(
  projects: SubProjectInfo[],
  cwd: string,
  fsp: any,
  pth: any,
): Promise<{ projectConfigs: ProjectConfigs[]; rootDockerCompose?: string; rootEnvExample?: string }> {
  const projectConfigs: ProjectConfigs[] = [];

  for (const proj of projects) {
    const dir = proj.cwd;
    const cfg: ProjectConfigs = {
      dir: proj.dir,
      type: proj.type,
      command: proj.command,
      args: proj.args,
    };

    cfg.makefile = (await fsp.readFile(pth.join(dir, 'Makefile'), 'utf-8').catch(() => null))?.slice(0, CONFIG_MAX);
    const pkgJson = await fsp.readFile(pth.join(dir, 'package.json'), 'utf-8').catch(() => null);
    if (pkgJson) {
      try {
        const scripts = JSON.parse(pkgJson).scripts;
        if (scripts) cfg.packageScripts = JSON.stringify(scripts).slice(0, SCRIPTS_MAX);
      } catch { /* best-effort */ }
    }
    cfg.readme = (await fsp.readFile(pth.join(dir, 'README.md'), 'utf-8').catch(() => null))?.slice(0, README_MAX);
    // Read .env.example or .env (mask values in .env for safety)
    const envExample = (await fsp.readFile(pth.join(dir, '.env.example'), 'utf-8').catch(() => null))?.slice(0, ENV_MAX);
    cfg.envExample = envExample != null ? envExample
      : (await fsp.readFile(pth.join(dir, '.env'), 'utf-8').catch(() => null))
        ?.replace(/=.*/g, '=***')?.slice(0, ENV_MAX);
    cfg.dockerfile = (await fsp.readFile(pth.join(dir, 'Dockerfile'), 'utf-8').catch(() => null))?.slice(0, DOCKERFILE_MAX);

    projectConfigs.push(cfg);
  }

  const rootDockerCompose = (await fsp.readFile(pth.join(cwd, 'docker-compose.yml'), 'utf-8').catch(() => null))
    || (await fsp.readFile(pth.join(cwd, 'docker-compose.yaml'), 'utf-8').catch(() => null));
  const rootEnvExample = (await fsp.readFile(pth.join(cwd, '.env.example'), 'utf-8').catch(() => null))?.slice(0, ENV_MAX);

  return {
    projectConfigs,
    rootDockerCompose: rootDockerCompose?.slice(0, CONFIG_MAX),
    rootEnvExample,
  };
}

// ============================================================
// Prompt building
// ============================================================

function buildAnalysisPrompt(
  configs: ProjectConfigs[],
  cwd: string,
  rootDockerCompose?: string,
  rootEnvExample?: string,
): string {
  let task = `Analyze the following multi-service development project for correct startup.

Working directory: ${cwd}

Detected services:
`;

  for (const cfg of configs) {
    task += `
Service: ${cfg.dir}
  Type: ${cfg.type}
  Detected command: ${cfg.command} ${cfg.args.join(' ')}
  Config files:
  --- Makefile ---
${cfg.makefile || '(not found)'}
  --- package.json scripts ---
${cfg.packageScripts || '(not found)'}
  --- README.md ---
${cfg.readme || '(not found)'}
  --- .env / .env.example ---
${cfg.envExample || '(not found)'}
  --- Dockerfile ---
${cfg.dockerfile || '(not found)'}
  --- end ---
`;
  }

  if (rootDockerCompose) {
    task += `
Root-level docker-compose.yml:
--- docker-compose.yml ---
${rootDockerCompose}
--- end ---
`;
  }

  if (rootEnvExample) {
    task += `
Root-level .env.example:
--- .env.example ---
${rootEnvExample}
--- end ---
`;
  }

  task += `
For each service, determine:
1. Is the detected command correct for STARTING this service (not building, testing, or migrating)?
2. Does this service start a long-running server process (HTTP server, gRPC, etc.)?
3. What port does it listen on (if a server)? Check config files, Dockerfiles, and README.
4. Does it depend on other services by directory name (e.g., API depends on DB)?
5. Are there any warnings? (e.g., "make run" actually runs tests, not a server; missing env files; hardcoded ports; conflicting ports between services)
6. Are there prerequisites that must be done first? (e.g., database migration, .env file creation, install step)
7. What is the correct startup ORDER? List directory names of services that must start first.

IMPORTANT: If a service's detected command is NOT for starting a server (e.g., it runs tests, lints, or builds), setIsServer to false and add a warning explaining why. If a Makefile's default target is "all" or "build" (not a dev server), flag it.

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{
  "services": [
    {
      "dir": "<directory name>",
      "verifiedCommand": "<correct command or the detected command>",
      "isServer": true,
      "port": 8080,
      "dependencies": ["<other-dir>"],
      "warnings": ["<warning text>"],
      "prerequisites": ["<prerequisite text>"]
    }
  ],
  "suggestedOrder": ["<dir1>", "<dir2>"],
  "overallWarnings": ["<global warning>"],
  "confidence": "low|medium|high"
}

Use "medium" confidence if you can infer from config files. Use "high" only if README or scripts explicitly confirm the setup. Use "low" if you are guessing based on file names alone.
The "dir" values MUST match exactly the directory names listed above.`;

  return task;
}

// ============================================================
// Response parsing
// ============================================================

function parseAnalysisResponse(content: string, projectDirs: string[]): StartupAnalysis | null {
  if (!content) return null;

  let json: any = null;

  // Tier 1: direct JSON parse
  try { json = JSON.parse(content.trim()); } catch { /* best-effort */ }

  // Tier 2: extract from markdown code fence
  if (!json) {
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try { json = JSON.parse(fence[1].trim()); } catch { /* best-effort */ }
    }
  }

  // Tier 3: find outermost { ... }
  if (!json) {
    const brace = content.match(/\{[\s\S]*\}/);
    if (brace) {
      try { json = JSON.parse(brace[0]); } catch { /* best-effort */ }
    }
  }

  if (!json || !Array.isArray(json.services)) return null;

  // Validate and fill defaults
  const dirSet = new Set(projectDirs);
  const services: StartupServiceAnalysis[] = json.services
    .filter((s: any) => s && typeof s.dir === 'string' && dirSet.has(s.dir))
    .map((s: any) => ({
      dir: s.dir,
      verifiedCommand: typeof s.verifiedCommand === 'string' ? s.verifiedCommand : '',
      isServer: s.isServer === true,
      port: typeof s.port === 'number' ? s.port : undefined,
      dependencies: Array.isArray(s.dependencies) ? s.dependencies.filter((d: any) => typeof d === 'string' && dirSet.has(d)) : [],
      warnings: Array.isArray(s.warnings) ? s.warnings.filter((w: any) => typeof w === 'string') : [],
      prerequisites: Array.isArray(s.prerequisites) ? s.prerequisites.filter((p: any) => typeof p === 'string') : [],
    }));

  if (services.length === 0) return null;

  const suggestedOrder: string[] = Array.isArray(json.suggestedOrder)
    ? json.suggestedOrder.filter((d: any) => typeof d === 'string' && dirSet.has(d))
    : [];

  const overallWarnings: string[] = Array.isArray(json.overallWarnings)
    ? json.overallWarnings.filter((w: any) => typeof w === 'string')
    : [];

  const confidence: 'low' | 'medium' | 'high' =
    ['low', 'medium', 'high'].includes(json.confidence) ? json.confidence : 'low';

  return { services, suggestedOrder, overallWarnings, confidence };
}

// ============================================================
// Main entry point
// ============================================================

export async function analyzeStartupPlan(
  projects: SubProjectInfo[],
  cwd: string,
  provider: AIProviderAdapter,
  fsp: any,
  pth: any,
): Promise<StartupAnalysis | null> {
  if (projects.length === 0) return null;

  // Read config files
  const { projectConfigs, rootDockerCompose, rootEnvExample } = await readConfigs(projects, cwd, fsp, pth);

  // Build prompt
  const task = buildAnalysisPrompt(projectConfigs, cwd, rootDockerCompose, rootEnvExample);

  // Call AI with timeout
  let result: string | null = null;
  try {
    result = await Promise.race([
      provider.chat({
        systemPrompt: 'You are a project startup analysis expert. Analyze development project configurations and output structured JSON about startup commands, dependencies, and potential issues. Be concise and accurate.',
        task,
        context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
        history: '',
      }).then(res => res.content).catch(() => null),
      new Promise<null>(resolve => { const _t = setTimeout(() => resolve(null), AI_TIMEOUT_MS); }),
    ]);
  } catch {
    return null;
  }

  if (!result) return null;

  const projectDirs = projects.map(p => p.dir);
  return parseAnalysisResponse(result, projectDirs);
}
