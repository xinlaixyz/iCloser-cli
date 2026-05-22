// src/commands/agent.ts — ic agent command
// Extracted from src/index.ts (architecture split)
// Registers: agent (create | start | stop | list | status | children | message | orchestrate)

import { Command } from 'commander';
import chalk from 'chalk';
import { success, fail, warn, info, progress, section, printError } from '../cli/output.js';
import { jsonEnvelope } from '../cli/json.js';
import { statusLabel } from './task.js';
import type { AgentStatus, AgentType } from '../types.js';

export function registerAgentCommands(program: Command): void {
  // ic agent — multi-agent management
  // ============================================================
  program.command('agent')
    .alias('ag')
    .description('管理 AI Agent')
    .argument('[subcommand]', 'create | start | stop | list | status | children | message')
    .argument('[args...]', '额外参数')
    .allowUnknownOption(true)
    .action(async (subcommand: string | undefined, args: string[]) => {
      try {
        const { AgentManager } = await import('../agent/manager.js');
        const { loadConfig } = await import('../config.js');
        const rootPath = process.cwd();
        const config = await loadConfig(rootPath);

        if (!config) { fail('项目未初始化，请先运行 ic init'); }

        const mgr = new AgentManager(config.ai, 3);

        if (!subcommand || subcommand === 'list') {
          const statusFilter = args.includes('--status') ? args[args.indexOf('--status') + 1] : undefined;
          const list = mgr.list(statusFilter ? { status: statusFilter as AgentStatus } : undefined);

          if (args.includes('--json')) {
            console.log(JSON.stringify(jsonEnvelope('agent-list', { agents: list.map(a => ({ id: a.id, name: a.name, type: a.type, status: a.status, model: a.model, children: a.childIds.length })) }), null, 2));
          } else {
            if (list.length === 0) { info('没有 Agent'); return; }
            for (const a of list) {
              const icon = a.status === 'running' ? '[·]' : a.status === 'done' ? '[✓]' : a.status === 'failed' ? '[✗]' : '[i]';
              console.log(`  ${icon} ${chalk.cyan(a.id.substring(0, 8))}  ${a.name}  ${chalk.dim(a.type)}  ${statusLabel(a.status)}`);
            }
          }
          return;
        }

        if (subcommand === 'create') {
          const name = args[0];
          const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'task';
          if (!name) { fail('用法: ic agent create <name> [--type task|review|verify|orchestrator]'); }

          const agent = mgr.create({ name, type: (type as AgentType) || 'task', model: args.includes('--model') ? args[args.indexOf('--model') + 1] : undefined });

          if (args.includes('--json')) {
            console.log(JSON.stringify(jsonEnvelope('agent-created', { id: agent.id, name: agent.name, type: agent.type }), null, 2));
          } else {
            success(`Agent ${chalk.cyan(agent.name)} 已创建 (${chalk.dim(agent.id)})`);
          }
          return;
        }

        if (subcommand === 'start') {
          const agentId = args[0];
          const task = args.slice(1).join(' ');
          if (!agentId) { fail('用法: ic agent start <agent-id> [task]'); }

          const started = await mgr.start(agentId, task || undefined);
          if (started) {
            success(`Agent ${chalk.cyan(agentId.substring(0, 8))} 已启动`);
          } else {
            const agent = mgr.get(agentId);
            if (!agent) fail(`Agent ${agentId} 不存在`);
            else if (agent.status === 'running') warn('Agent 已在运行');
            else warn(`无法启动 (status: ${agent.status})`);
          }
          return;
        }

        if (subcommand === 'stop') {
          const agentId = args[0];
          if (!agentId) { fail('用法: ic agent stop <agent-id>'); }
          if (mgr.stop(agentId)) success(`Agent ${chalk.cyan(agentId.substring(0, 8))} 已停止`);
          else fail(`Agent ${agentId} 不存在`);
          return;
        }

        if (subcommand === 'status') {
          const agentId = args[0];
          if (!agentId) { fail('用法: ic agent status <agent-id>'); }
          const agent = mgr.get(agentId);
          if (!agent) { fail(`Agent ${agentId} 不存在`); }

          if (args.includes('--json')) {
            console.log(JSON.stringify(jsonEnvelope('agent-status', { id: agent.id, name: agent.name, type: agent.type, status: agent.status, model: agent.model, children: agent.childIds, result: agent.result }), null, 2));
          } else {
            console.log(`  ${chalk.bold(agent.name)}  ${chalk.dim(`(${agent.type})`)}`);
            console.log(`  状态: ${statusLabel(agent.status)}  模型: ${agent.model}`);
            if (agent.result) console.log(`  结果: ${agent.result.success ? '成功' : '失败'}  tokens: ${agent.result.tokensUsed}  ${agent.result.duration}ms`);
          }
          return;
        }

        if (subcommand === 'children') {
          const parentId = args[0];
          if (!parentId) { fail('用法: ic agent children <agent-id>'); }
          const children = mgr.list({ parentId });
          if (children.length === 0) { info('无子 Agent'); return; }
          for (const c of children) {
            console.log(`  ${chalk.cyan(c.id.substring(0, 8))}  ${c.name}  ${chalk.dim(c.type)}  ${statusLabel(c.status)}`);
          }
          return;
        }

        if (subcommand === 'message') {
          const agentId = args[0];
          const content = args.slice(1).join(' ');
          if (!agentId || !content) { fail('用法: ic agent message <agent-id> <content>'); }
          const msg = mgr.sendMessage({ from: 'cli', to: agentId, content, type: 'command' });
          success(`消息已发送 (${msg.id})`);
          return;
        }

        if (subcommand === 'orchestrate') {
          const taskDesc = args.join(' ');
          if (!taskDesc) { fail('用法: ic agent orchestrate <任务描述>'); }
          progress('编排任务...');
          const result = await mgr.orchestrate(taskDesc);
          if (result.success) {
            success(result.summary);
            for (const cr of result.childResults) {
              const icon = cr.success ? '[✓]' : '[✗]';
              console.log(`  ${icon} ${cr.agentName}: ${cr.output.slice(0, 100)}`);
            }
          } else {
            fail(result.summary);
          }
          return;
        }

        warn(`未知子命令: ${subcommand}。可用: create, start, stop, list, status, children, message, orchestrate`);
      } catch (err) { printError(err as Error); }
    });
}
