import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

// 2. Test ic agent create (CLI)
const createResult = run(process.execPath, [cli, 'agent', 'create', 'smoke-test', '--type', 'task', '--json'], root);
if (createResult.status !== 0) throw new Error('agent create failed');
const createData = JSON.parse(createResult.stdout);
if (createData.kind !== 'agent-created') throw new Error('wrong agent-create kind');
if (!createData.data.id) throw new Error('no agent id');
console.log('  Agent create: OK');

// 3. Test ic agent list (CLI, empty — agents are process-local)
const listResult = run(process.execPath, [cli, 'agent', 'list', '--json'], root);
if (listResult.status !== 0) throw new Error('agent list failed');
const listData = JSON.parse(listResult.stdout);
if (listData.kind !== 'agent-list') throw new Error('wrong agent-list kind');
console.log('  Agent list: OK');

// 4. Test agent create + status in same process via Node API
const testResult = run(process.execPath, ['-e', `
  import('./dist/agent/manager.js').then(async ({ AgentManager }) => {
    const mgr = new AgentManager({ provider: 'mock', model: 'mock-offline', maxTokens: 2048, temperature: 0.3 }, 2);
    const parent = mgr.create({ name: '编排', type: 'orchestrator' });
    const child = mgr.create({ name: '执行', type: 'task', parentId: parent.id });
    const started = await mgr.start(child.id, '测试任务');
    if (!started) { console.log(JSON.stringify({ ok: false, err: 'not started' })); return; }
    await new Promise(r => setTimeout(r, 500));
    const agent = mgr.get(child.id);
    console.log(JSON.stringify({
      ok: agent.status === 'done',
      status: agent.status,
      hasResult: !!agent.result,
      parentChildren: mgr.get(parent.id).childIds.length === 1,
      activeCount: mgr.activeCount()
    }));
  }).catch(e => console.log(JSON.stringify({ ok: false, err: e.message })));
`], root);
if (testResult.status !== 0) throw new Error(`agent API test failed: ${testResult.stderr}`);
const apiResult = JSON.parse(testResult.stdout.trim());
if (!apiResult.ok) throw new Error(`agent API test: ${apiResult.err || 'agent not done'}`);
console.log('  Agent hierarchy + execution: OK');

// 5. Verify agent types
const typeResult = run(process.execPath, [cli, 'agent', 'create', 'reviewer', '--type', 'review', '--json'], root);
if (typeResult.status !== 0) throw new Error('agent create review failed');
const typeData = JSON.parse(typeResult.stdout);
if (typeData.data.type !== 'review') throw new Error('wrong agent type');
console.log('  Agent type: OK');

console.log('\n[agent-smoke] PASS');
