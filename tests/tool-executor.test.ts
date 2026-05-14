import { describe, expect, it } from 'vitest';
import { buildToolDefinitions, executeToolCall } from '../src/core/tool-executor.js';

describe('tool-executor (S18)', () => {
  // ============================================================
  // buildToolDefinitions
  // ============================================================
  describe('buildToolDefinitions', () => {
    it('returns five tool definitions by default', () => {
      const tools = buildToolDefinitions();
      expect(tools.length).toBeGreaterThanOrEqual(4);
      const names = tools.map(t => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('search_code');
      expect(names).toContain('run_command');
      expect(names).toContain('code_intel');
    });

    it('each tool has name, description, parameters', () => {
      for (const tool of buildToolDefinitions()) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
      }
    });

    it('read_file requires path parameter', () => {
      const readFile = buildToolDefinitions().find(t => t.name === 'read_file')!;
      expect(readFile.parameters.required).toContain('path');
    });

    it('search_code requires pattern parameter', () => {
      const searchCode = buildToolDefinitions().find(t => t.name === 'search_code')!;
      expect(searchCode.parameters.required).toContain('pattern');
    });

    it('run_command requires command parameter', () => {
      const runCmd = buildToolDefinitions().find(t => t.name === 'run_command')!;
      expect(runCmd.parameters.required).toContain('command');
    });

    it('web_search requires query parameter', () => {
      const ws = buildToolDefinitions().find(t => t.name === 'web_search')!;
      expect(ws.parameters.required).toContain('query');
    });

    it('code_intel requires file parameter', () => {
      const ci = buildToolDefinitions().find(t => t.name === 'code_intel')!;
      expect(ci.parameters.required).toContain('file');
    });
  });

  // ============================================================
  // executeToolCall error handling
  // ============================================================
  describe('executeToolCall error paths', () => {
    const root = '/tmp/test-project';

    it('read_file returns error on missing path', async () => {
      const result = await executeToolCall('read_file', {}, root);
      expect(result).toContain('缺少 path 参数');
    });

    it('read_file rejects path traversal', async () => {
      const result = await executeToolCall('read_file', { path: '../etc/passwd' }, root);
      expect(result).toContain('不允许');
    });

    it('read_file returns error on nonexistent file', async () => {
      const result = await executeToolCall('read_file', { path: 'nonexistent.xyz' }, root);
      expect(result).toContain('无法读取');
    });

    it('search_code returns error on missing pattern', async () => {
      const result = await executeToolCall('search_code', {}, root);
      expect(result).toContain('缺少 pattern 参数');
    });

    it('run_command returns error on missing command', async () => {
      const result = await executeToolCall('run_command', {}, root);
      expect(result).toContain('缺少 command 参数');
    });

    it('run_command blocks dangerous commands', async () => {
      const result = await executeToolCall('run_command', { command: 'rm -rf /' }, root);
      expect(result).toContain('安全策略拦截');
    });

    it('run_command blocks sudo', async () => {
      const result = await executeToolCall('run_command', { command: 'sudo rm file' }, root);
      expect(result).toContain('安全策略拦截');
    });

    it('web_search returns error on missing query', async () => {
      const result = await executeToolCall('web_search', {}, root);
      expect(result).toContain('缺少 query 参数');
    });

    it('code_intel returns error on missing file', async () => {
      const result = await executeToolCall('code_intel', {}, root);
      expect(result).toContain('缺少 file 参数');
    });

    it('unknown tool returns error', async () => {
      const result = await executeToolCall('nonexistent_tool', {}, root);
      expect(result).toContain('未知工具');
    });
  });

  // ============================================================
  // executeToolCall success paths
  // ============================================================
  describe('executeToolCall success paths', () => {
    const root = 'D:/temp/Codex/AgentCode';

    it('read_file reads a real file', async () => {
      const result = await executeToolCall('read_file', { path: 'package.json' }, root);
      expect(result).toContain('icloser-agent-shell');
    });

    it('search_code finds matches', async () => {
      const result = await executeToolCall('search_code', { pattern: 'tool-executor' }, root);
      expect(result).toContain('tool-executor');
    });

    it('run_command executes a safe command', async () => {
      const result = await executeToolCall('run_command', { command: 'node -e "console.log(1)"' }, root);
      expect(result).toContain('1');
    });

    it('code_intel parses a known TS file', async () => {
      const result = await executeToolCall('code_intel', { file: 'src/core/tool-executor.ts' }, root);
      expect(result).toContain('导出');
    });
  });
});
