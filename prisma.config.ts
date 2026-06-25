import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` (run on postinstall, incl. CI) loads this config but never
// connects, so DATABASE_URL may be absent there. Fall back to a placeholder so
// generate doesn't throw; migrate/seed require the real value via the env.
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://placeholder';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'pnpm exec tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
