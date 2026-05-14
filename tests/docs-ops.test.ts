import { describe, expect, it } from 'vitest';
import { readFileContent, summarizeDoc, reviewDoc, rewriteDoc } from '../src/core/docs-generator.js';

describe('docs-generator (D1-D9)', () => {
  describe('readFileContent', () => {
    it('reads an existing file', async () => {
      const content = await readFileContent(process.cwd(), 'package.json');
      expect(content).toContain('"name"');
    });

    it('throws for non-existent file', async () => {
      await expect(readFileContent(process.cwd(), 'nonexistent.xyz')).rejects.toThrow();
    });
  });

  describe('summarizeDoc', () => {
    it('returns a string with mock provider', async () => {
      const config = {
        ai: { provider: 'mock' as const, model: 'mock', maxTokens: 500, temperature: 0.3 },
      };
      const result = await summarizeDoc('# Test\n\nThis is test content.', config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('reviewDoc', () => {
    it('returns parsed issues with mock provider', async () => {
      const config = {
        ai: { provider: 'mock' as const, model: 'mock', maxTokens: 1000, temperature: 0.3 },
      };
      const content = '# API\n\n## Auth\n\nUse JWT tokens.';
      const issues = await reviewDoc(content, config);
      expect(Array.isArray(issues)).toBe(true);
    });
  });

  describe('rewriteDoc', () => {
    it('returns content with mock provider', async () => {
      const config = {
        ai: { provider: 'mock' as const, model: 'mock', maxTokens: 1000, temperature: 0.5 },
      };
      const content = '# API\n\nUse this interface to configure the server.';
      const result = await rewriteDoc(content, 'beginner', config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
