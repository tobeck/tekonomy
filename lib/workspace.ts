import { prisma } from '@/lib/db/client';

// Phase 1 stub: a single personal workspace. Resolved once from the DB and
// cached for the process lifetime. Phase 2 will replace this with the auth
// session — do NOT refactor it to read auth here.
let cachedWorkspaceId: string | null = null;

export async function currentWorkspaceId(): Promise<string> {
  if (cachedWorkspaceId) return cachedWorkspaceId;

  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { kind: 'PERSONAL' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  cachedWorkspaceId = workspace.id;
  return cachedWorkspaceId;
}
