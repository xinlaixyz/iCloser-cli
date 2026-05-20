import { describe, expect, it, vi } from 'vitest';

const webSearchMock = vi.hoisted(() => ({
  searchWeb: vi.fn(),
}));

vi.mock('../src/core/web-search.js', () => ({
  searchWeb: webSearchMock.searchWeb,
  isWebSearchAvailable: () => true,
  getWebSearchStatus: () => 'available',
}));

describe('tool-executor web_search project cache path', () => {
  it('passes rootPath into searchWeb so disk cache is project-scoped', async () => {
    webSearchMock.searchWeb.mockResolvedValueOnce([
      { title: 'Result A', url: 'https://example.com/a', snippet: 'snippet' },
    ]);
    const { executeToolCall } = await import('../src/core/tool-executor.js');

    const rootPath = 'D:/tmp/project-a';
    const result = await executeToolCall('web_search', { query: 'TypeScript AST' }, rootPath);

    expect(result).toContain('Result A');
    expect(webSearchMock.searchWeb).toHaveBeenCalledWith('TypeScript AST', {
      maxResults: 3,
      rootPath,
    });
  });
});
