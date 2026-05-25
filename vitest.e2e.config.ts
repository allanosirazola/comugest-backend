import { defineConfig } from 'vitest/config';

/**
 * Vitest config for end-to-end tests.
 * These tests use the real PostgreSQL database (comugest_test) and
 * do NOT mock Prisma — they exercise the full stack via supertest.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/e2e/**/*.test.ts'],
    setupFiles: ['./src/test/e2e/setup.ts'],
    // E2E tests run sequentially to avoid DB conflicts
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
    },
  },
});
