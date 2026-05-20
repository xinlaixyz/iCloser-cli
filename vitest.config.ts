import { defineConfig } from 'vitest/config';

process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--no-warnings']
  .filter(Boolean)
  .join(' ');

export default defineConfig({
  test: {
    testTimeout: 30000,
    cache: false,
    server: {
      deps: {
        external: ['node:sqlite'],
        interopDefault: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'tests/**'],
      all: true,
    },
  },
});
