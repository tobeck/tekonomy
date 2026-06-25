import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString = process.env.DATABASE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

beforeAll(() => {
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set for integration tests');
  }
  // Apply committed migrations and seed against the live database.
  execSync('pnpm exec prisma migrate deploy', { stdio: 'inherit' });
  execSync('pnpm exec prisma db seed', { stdio: 'inherit' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('seeded database', () => {
  it('has the default user', async () => {
    const user = await prisma.user.findFirst();
    expect(user).not.toBeNull();
    expect(user?.displayName).toBe('Tobias');
  });

  it('has a single personal workspace with an OWNER membership', async () => {
    const workspace = await prisma.workspace.findFirstOrThrow({
      where: { kind: 'PERSONAL' },
    });
    const membership = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    });
    expect(membership.role).toBe('OWNER');
  });

  it('has the SEB Privatkonto checking account in SEK', async () => {
    const account = await prisma.account.findFirstOrThrow({
      where: { name: 'SEB Privatkonto' },
    });
    expect(account.kind).toBe('CHECKING');
    expect(account.currency).toBe('SEK');
  });

  it('has the nine default categories', async () => {
    const names = (
      await prisma.category.findMany({ select: { name: true }, orderBy: { name: 'asc' } })
    ).map((c) => c.name);
    expect(names).toEqual(
      [
        'Groceries',
        'Restaurants',
        'Transport',
        'Subscriptions',
        'Housing',
        'Utilities',
        'Income',
        'Transfers',
        'Other',
      ].sort(),
    );
  });

  it('has the ten starter rules, each linked to a category', async () => {
    const rules = await prisma.rule.findMany({ include: { category: true } });
    expect(rules).toHaveLength(10);
    expect(rules.every((r) => r.matchType === 'CONTAINS')).toBe(true);
    expect(rules.every((r) => r.category !== null)).toBe(true);

    const hemkop = rules.find((r) => r.pattern === 'HEMKOP');
    expect(hemkop?.category.name).toBe('Groceries');
  });
});
