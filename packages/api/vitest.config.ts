import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: 'forks',
    singleFork: true,
    fileParallelism: false,
    setupFiles: ['test/helpers/setup.ts'],
  },
});
