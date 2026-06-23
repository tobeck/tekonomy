import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Prisma 7 connects through a driver adapter rather than a datasource `url`.
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

// Reuse a single client across hot reloads in dev to avoid exhausting
// connections. The Prisma client is the one sanctioned singleton.
const globalForPrisma = globalThis as unknown as {
  __prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}
