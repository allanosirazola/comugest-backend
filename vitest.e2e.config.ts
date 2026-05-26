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
    // Pre-set env vars at the config level so they are available before any
    // module is loaded (important for env.ts validation that runs at import time).
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://comugest:comugest@localhost:5432/comugest_test?schema=public',
      JWT_ACCESS_SECRET: 'e2e-test-access-secret-at-least-32-chars-long!!',
      JWT_REFRESH_SECRET: 'e2e-test-refresh-secret-at-least-32-chars-long!!',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '30d',
      BCRYPT_ROUNDS: '10',
      EMAIL_PROVIDER: 'console',
      STRIPE_SECRET_KEY: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      PORT: '4001',
      RATE_LIMIT_MAX: '10000',
      RATE_LIMIT_WINDOW_MS: '900000',
    },
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
