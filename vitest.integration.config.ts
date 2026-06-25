import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

// DB-touching tests. Kept separate from the default unit run so CI's
// `pnpm test` stays DB-free; run with `pnpm test:integration` against a live
// Postgres (docker/docker-compose.dev.yml).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Migrations + seed per file need headroom over the 5s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
