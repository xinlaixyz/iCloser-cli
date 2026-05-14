import { describe, expect, it } from 'vitest';
import {
  AIOutputContractError,
  createAIOutputContract,
  formatAIOutputContract,
  parseAIOutput,
} from '../src/ai/output-contract.js';

describe('AI output contract', () => {
  it('parses fenced JSON output contract', () => {
    const out = parseAIOutput(`说明\n${formatAIOutputContract(createAIOutputContract('update file', [{
      file: 'src/hello.ts',
      operation: 'write',
      content: 'export const hello = "world";\n',
      reasoning: 'update hello',
    }]))}`);

    expect(out.summary).toBe('update file');
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0].file).toBe('src/hello.ts');
    expect(out.changes[0].operation).toBe('write');
  });

  it('keeps legacy write blocks compatible', () => {
    const out = parseAIOutput('```write:src/a.ts\nexport const a = 1;\n```');
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]).toMatchObject({
      file: 'src/a.ts',
      operation: 'write',
      reasoning: 'legacy write block',
    });
  });

  it('parses a JSON contract surrounded by prose', () => {
    const out = parseAIOutput([
      '下面是本次修改：',
      JSON.stringify({
        summary: 'wrapped json',
        changes: [{
          file: 'src/wrapped.ts',
          operation: 'write',
          content: 'export const wrapped = true;\n',
          reasoning: 'model added prose around json',
        }],
      }),
      '以上。',
    ].join('\n'));

    expect(out.summary).toBe('wrapped json');
    expect(out.changes[0].file).toBe('src/wrapped.ts');
  });

  it('ignores unrelated JSON and parses the valid contract candidate', () => {
    const out = parseAIOutput([
      '{"note":"not a contract"}',
      JSON.stringify({
        summary: 'second object',
        changes: [{
          file: 'src/second.ts',
          operation: 'write',
          content: 'export const second = true;\n',
          reasoning: 'valid second object',
        }],
      }),
    ].join('\n'));

    expect(out.summary).toBe('second object');
    expect(out.changes[0].file).toBe('src/second.ts');
  });

  it('rejects output without changes', () => {
    expect(() => parseAIOutput('普通文本')).toThrow(AIOutputContractError);
  });

  it('rejects empty changes', () => {
    expect(() => parseAIOutput('{"summary":"x","changes":[]}')).toThrow('changes 为空');
  });

  it('rejects path traversal', () => {
    expect(() => parseAIOutput(JSON.stringify({
      summary: 'bad',
      changes: [{
        file: '../secret.txt',
        operation: 'write',
        content: 'secret',
        reasoning: 'bad path',
      }],
    }))).toThrow('不能越界');
  });

  it('rejects absolute paths', () => {
    expect(() => parseAIOutput(JSON.stringify({
      summary: 'bad',
      changes: [{
        file: 'C:/temp/secret.txt',
        operation: 'write',
        content: 'secret',
        reasoning: 'bad path',
      }],
    }))).toThrow('相对路径');
  });

  it('rejects unsupported operations', () => {
    expect(() => parseAIOutput(JSON.stringify({
      summary: 'bad',
      changes: [{
        file: 'src/a.ts',
        operation: 'delete',
        content: 'x',
        reasoning: 'bad operation',
      }],
    }))).toThrow('operation 仅支持 write');
  });
});
