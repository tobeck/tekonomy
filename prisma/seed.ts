import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL ?? 'tobias.becker.olsson@gmail.com';

const CATEGORIES = [
  'Groceries',
  'Restaurants',
  'Transport',
  'Subscriptions',
  'Housing',
  'Utilities',
  'Income',
  'Transfers',
  'Other',
] as const;

// Starter CONTAINS rules covering visible patterns from the SEB sample.
// Ordered by descending priority; earlier entries win on ties.
const STARTER_RULES: ReadonlyArray<{ pattern: string; category: (typeof CATEGORIES)[number] }> = [
  { pattern: 'HEMKOP', category: 'Groceries' },
  { pattern: 'EATALY', category: 'Restaurants' },
  { pattern: 'EASYPARK', category: 'Transport' },
  { pattern: 'PARKMAN', category: 'Transport' },
  { pattern: 'LÖN', category: 'Income' },
  { pattern: 'AVANZA', category: 'Transfers' },
  { pattern: 'DISNEY PLUS', category: 'Subscriptions' },
  { pattern: 'PRIME VIDEO', category: 'Subscriptions' },
  { pattern: 'BOOKBEAT', category: 'Subscriptions' },
  { pattern: 'PAYPAL', category: 'Other' },
];

async function main() {
  const user = await prisma.user.upsert({
    where: { email: SEED_USER_EMAIL },
    update: {},
    create: { email: SEED_USER_EMAIL, displayName: 'Tobias' },
  });

  // Workspaces have no natural unique key; key the personal workspace off the
  // owning user's membership so re-seeding is idempotent.
  const existing = await prisma.workspace.findFirst({
    where: { kind: 'PERSONAL', memberships: { some: { userId: user.id } } },
  });

  const workspace =
    existing ??
    (await prisma.workspace.create({
      data: { name: 'Personal', kind: 'PERSONAL' },
    }));

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: 'OWNER' },
    create: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
  });

  // Account has no unique on (workspaceId, name), so guard with findFirst.
  const existingAccount = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, name: 'SEB Privatkonto' },
  });
  if (!existingAccount) {
    await prisma.account.create({
      data: {
        workspaceId: workspace.id,
        name: 'SEB Privatkonto',
        kind: 'CHECKING',
        currency: 'SEK',
      },
    });
  }

  const categoryByName = new Map<string, string>();
  for (const name of CATEGORIES) {
    const category = await prisma.category.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name } },
      update: {},
      create: { workspaceId: workspace.id, name },
    });
    categoryByName.set(name, category.id);
  }

  // Highest priority first; descending so order in the array = match precedence.
  let priority = STARTER_RULES.length;
  for (const { pattern, category } of STARTER_RULES) {
    const categoryId = categoryByName.get(category)!;
    const existingRule = await prisma.rule.findFirst({
      where: { workspaceId: workspace.id, matchType: 'CONTAINS', pattern },
    });
    if (existingRule) {
      await prisma.rule.update({
        where: { id: existingRule.id },
        data: { categoryId, priority },
      });
    } else {
      await prisma.rule.create({
        data: { workspaceId: workspace.id, matchType: 'CONTAINS', pattern, categoryId, priority },
      });
    }
    priority -= 1;
  }

  console.log(`Seeded workspace ${workspace.id} for ${user.email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
