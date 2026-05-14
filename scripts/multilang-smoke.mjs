import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf-8', timeout: 120000 });
}

// 1. Build
const build = process.platform === 'win32'
  ? run('cmd.exe', ['/d', '/s', '/c', 'npm run build'], root)
  : run('npm', ['run', 'build'], root);
if (build.status !== 0 || !existsSync(cli)) {
  process.stderr.write(build.stdout + build.stderr);
  throw new Error('build failed');
}

const { readFile } = await import('fs/promises');

async function testGoProject() {
  const dir = await mkdtemp(join(tmpdir(), 'icloser-go-'));
  try {
    await mkdir(join(dir, 'gopkg'), { recursive: true });
    await writeFile(join(dir, 'go.mod'), 'module example.com/app\n\ngo 1.22');
    await writeFile(join(dir, 'gopkg', 'server.go'), [
      'package gopkg',
      '',
      'import "fmt"',
      '',
      'type Server struct {',
      '\tPort int',
      '}',
      '',
      'func NewServer(port int) *Server {',
      '\treturn &Server{Port: port}',
      '}',
      '',
      'func (s *Server) Start() error {',
      '\tfmt.Printf("listening on :%d\\n", s.Port)',
      '\treturn nil',
      '}',
    ].join('\n'));

    const setup = run(process.execPath, [cli, 'setup', '--mock', '--json'], dir);
    if (setup.status !== 0) throw new Error('go setup failed');

    const init = run(process.execPath, [cli, 'init', '--force'], dir);
    if (init.status !== 0) throw new Error('go init failed');

    const scan = run(process.execPath, [cli, 'scan'], dir);
    if (scan.status !== 0) throw new Error(`go scan failed: ${scan.stderr}`);

    const idxPath = join(dir, '.icloser', 'index.json');
    if (!existsSync(idxPath)) throw new Error('go index.json missing');
    const data = JSON.parse(await readFile(idxPath, 'utf-8'));

    const allExports = (data.modules || []).flatMap(m => m.exports || []);
    const names = allExports.map(e => e.name);
    if (!names.includes('NewServer')) throw new Error(`Go export NewServer missing in [${names}]`);
    if (!names.includes('Server')) throw new Error('Go export Server missing');
    if (!names.includes('Start')) throw new Error('Go export Start missing');

    const allImports = (data.modules || []).flatMap(m => m.imports || []);
    if (allImports.length < 1) throw new Error('Go imports missing');

    console.log('  Go scan: OK');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testPythonProject() {
  const dir = await mkdtemp(join(tmpdir(), 'icloser-py-'));
  try {
    await mkdir(join(dir, 'pypkg'), { recursive: true });
    await writeFile(join(dir, 'pypkg', '__init__.py'), 'from .handler import handle_request\n\n__all__ = ["handle_request", "RequestHandler"]');
    await writeFile(join(dir, 'pypkg', 'handler.py'), [
      'import json',
      'from pathlib import Path',
      '',
      'def handle_request(data: dict) -> str:',
      '    return json.dumps(data)',
      '',
      'class RequestHandler:',
      '    def __init__(self, config_path: Path):',
      '        self.config_path = config_path',
      '',
      '    def process(self, request: dict) -> str:',
      '        return handle_request(request)',
    ].join('\n'));

    const setup = run(process.execPath, [cli, 'setup', '--mock', '--json'], dir);
    if (setup.status !== 0) throw new Error('py setup failed');

    const init = run(process.execPath, [cli, 'init', '--force'], dir);
    if (init.status !== 0) throw new Error('py init failed');

    const scan = run(process.execPath, [cli, 'scan'], dir);
    if (scan.status !== 0) throw new Error(`py scan failed: ${scan.stderr}`);

    const idxPath = join(dir, '.icloser', 'index.json');
    if (!existsSync(idxPath)) throw new Error('py index.json missing');
    const data = JSON.parse(await readFile(idxPath, 'utf-8'));

    const allExports = (data.modules || []).flatMap(m => m.exports || []);
    const names = allExports.map(e => e.name);
    if (!names.includes('handle_request')) throw new Error(`Python export handle_request missing in [${names}]`);
    if (!names.includes('RequestHandler')) throw new Error('Python export RequestHandler missing');

    const allImports = (data.modules || []).flatMap(m => m.imports || []);
    if (allImports.length < 1) throw new Error('Python imports missing');

    console.log('  Python scan: OK');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Run both tests
await testGoProject();
await testPythonProject();

console.log('\n[multilang-smoke] PASS Go + Python AST scan gate');
