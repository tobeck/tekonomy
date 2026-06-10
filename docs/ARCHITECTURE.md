# tekonomy — Architecture

> Self-hosted personal-economy app: upload bank-statement CSVs, see where money
> goes, and (later) set budget and savings goals, track loans and investments.
> Runs on a Proxmox VM in the homelab.

## Phase plan

**Phase 1 (this plan):** CSV upload → transaction list → spending dashboard.
Single user, single personal workspace. Schema is workspace-scoped so a
multi-user / "family workspace" UI can be added later without migration pain.

**Phase 2+ (out of scope here):** auth/login (NextAuth), workspace switcher,
shared family workspaces, budget goals, savings goals, loan/mortgage tracking,
investment portfolio tracking, multi-currency / FX.

## Stack

| Layer            | Choice                                               |
| ---------------- | ---------------------------------------------------- |
| Runtime          | Node.js 22 LTS                                       |
| Language         | TypeScript (strict)                                  |
| App framework    | Next.js 16 (App Router), React 19                    |
| Database         | PostgreSQL 16                                        |
| ORM              | Prisma 7                                             |
| UI               | Tailwind CSS + shadcn/ui (Radix primitives)          |
| Charts           | Recharts                                             |
| Table            | TanStack Table (server-driven)                       |
| Validation       | Zod (at every server boundary)                       |
| CSV parsing      | `csv-parse`                                          |
| Unit/integration | Vitest                                               |
| E2E              | Playwright (CI only)                                 |
| Lint / format    | ESLint + Prettier                                    |
| Package manager  | pnpm                                                 |
| CI               | GitHub Actions: lint, typecheck, test, build per PR  |
| Deploy           | Docker image + `docker-compose.yml` (app + postgres) |

## Domain model

Money is stored as **integer minor units (öre)** in a `BigInt` column. No
floats anywhere in the money path.

```
User(id, email, displayName, createdAt)
Workspace(id, name, kind: PERSONAL|SHARED, createdAt)
Membership(userId, workspaceId, role: OWNER|MEMBER)

Account(id, workspaceId, name, kind: CHECKING|SAVINGS, currency='SEK',
        createdAt)
Category(id, workspaceId, name, color, parentId?)
Rule(id, workspaceId, matchType: CONTAINS|REGEX, pattern, categoryId,
     priority)

Import(id, workspaceId, accountId, filename, sha256, rowCount,
       insertedCount, skippedDuplicateCount, importedAt)
Transaction(id, workspaceId, accountId, importId,
            bookedAt (date), valueAt (date)?,
            descriptionRaw, descriptionNorm,
            amountMinor (BigInt), currency='SEK',
            categoryId?,
            dedupeKey,
            UNIQUE(workspaceId, accountId, dedupeKey))
```

`descriptionNorm` = `descriptionRaw` lowercased, trimmed, with trailing
`/YY-MM-DD` date suffix stripped (SEB-style).
`dedupeKey` = `sha256(bookedAt.toISOString() + '|' + amountMinor + '|' +
descriptionNorm)`.

All domain rows carry `workspaceId`. Phase 1 reads `currentWorkspaceId()` from
a hard-coded constant; Phase 2 swaps in the auth session.

## Directory layout

```
tekonomy/
├── app/
│   ├── (dashboard)/
│   │   ├── page.tsx                # dashboard charts
│   │   ├── transactions/page.tsx
│   │   ├── import/page.tsx
│   │   └── accounts/page.tsx
│   ├── api/
│   │   ├── imports/route.ts        # POST CSV
│   │   ├── transactions/route.ts   # GET (paginated, filtered)
│   │   └── stats/route.ts          # GET aggregations
│   └── layout.tsx
├── components/
│   ├── ui/                         # shadcn primitives
│   ├── charts/
│   ├── tables/
│   └── forms/
├── lib/
│   ├── db/                         # prisma client singleton
│   ├── domain/
│   │   ├── categorization.ts       # rule engine
│   │   ├── dedupe.ts
│   │   └── stats.ts
│   ├── importers/
│   │   ├── types.ts                # BankProfile interface
│   │   ├── registry.ts             # available profiles
│   │   └── seb-privatkonto/        # one dir per bank
│   └── workspace.ts                # currentWorkspaceId() — Phase 1 stub
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                     # default user, workspace, categories
├── tests/
│   ├── unit/
│   └── integration/                # postgres via testcontainers
├── e2e/                            # playwright, CI only
├── .github/workflows/ci.yml
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── docs/
│   └── ARCHITECTURE.md             # this file
├── CLAUDE.md                       # agent contract
└── package.json, tsconfig.json, ...
```

## CSV import pipeline

1. `POST /api/imports` — `multipart/form-data` with `file`, `accountId`,
   `bankProfile`.
2. Server loads the `BankProfile` from the registry, parses the file to
   `RawRow[]`.
3. Each row → Zod-validated `ParsedTx { bookedAt, valueAt?, descriptionRaw,
amountMinor }`.
4. Compute `descriptionNorm` and `dedupeKey` per row.
5. Single DB transaction: insert all rows, skipping those whose
   `(workspaceId, accountId, dedupeKey)` already exist.
6. Run the categorization rule engine on inserted rows.
7. Return `{ importId, inserted, skippedDuplicates }`. The uploaded file is
   discarded; only the `Import` audit row + parsed transactions persist.

### `BankProfile` interface

```ts
interface BankProfile {
  id: string; // 'seb-privatkonto'
  label: string; // 'SEB Privatkonto'
  parse(buf: Buffer): RawRow[]; // pure, deterministic
  toParsed(row: RawRow): ParsedTx; // bank-specific mapping
}
```

### First bank profile: SEB Privatkonto

Sample headers: `Bokföringsdatum;Valutadatum;Verifikationsnummer;Text;Belopp;Saldo`

- Delimiter: `;`
- Encoding: UTF-8 (fall back to Windows-1252 on BOM/encoding error).
- Dates: ISO `YYYY-MM-DD` — `Bokföringsdatum` → `bookedAt`,
  `Valutadatum` → `valueAt`.
- `Text` → `descriptionRaw`. `descriptionNorm` strips trailing `/YY-MM-DD`.
- `Belopp` is whole kronor with `.` as a **thousands separator** and no
  decimals: `"-12.000"` = −12 SEK, `"44983.000"` = 44 983 SEK. Parser:
  `amountMinor = parseInt(belopp.replace(/\./g, ''), 10) * 100`. Sign
  preserved from the source. Negative = outflow.
- `Verifikationsnummer` is **not** unique — store as metadata only.
- `Saldo` (running balance) is ignored in Phase 1.

## Categorization

- Phase 1 seeds a default category set per new workspace (Groceries,
  Restaurants, Transport, Subscriptions, Housing, Utilities, Income,
  Transfers, Other).
- `Rule` rows are seeded with a starter set of `CONTAINS` patterns (e.g.
  `HEMKOP` → Groceries, `EATALY` → Restaurants, `EASYPARK` → Transport,
  `LÖN` → Income, `AVANZA` → Transfers, `DISNEY PLUS` → Subscriptions, …).
- On import, the rule engine assigns the **highest-priority matching** rule
  to each new transaction. Unmatched rows get `categoryId = null` and surface
  in the UI as "Uncategorized".
- A manual re-categorization UI is a Phase-2 follow-up.

## Build order (Phase 1)

Numbered to mirror the issue board. Each step is one independently-shippable
PR and respects path boundaries.

1. **Scaffold** — Next.js 16 + TS + Tailwind + ESLint + Prettier + Vitest.
2. **CI** — GitHub Actions workflow (lint, typecheck, test, build).
3. **Postgres + Prisma + schema + seed**.
4. **App shell** — shadcn/ui, base layout, navigation, empty route stubs.
5. **Importer framework** — `BankProfile`, registry, generic parse → dedupe
   → insert pipeline. No bank profiles yet.
6. **SEB Privatkonto profile** — first concrete `BankProfile`.
7. **Import API + upload page** — `POST /api/imports` + the upload UI.
8. **Transactions list** — list page + `GET /api/transactions`
   (paginate/filter).
9. **Categorization engine + seed rules** — applied on import.
10. **Dashboard charts** — spending-by-category, spending-over-time.
11. **Docker + compose** — production image and Proxmox-ready compose file.

## Conventions agents must follow

- One issue → one branch → one PR. Stay within the issue's `Agent-Paths`.
- Money is `BigInt` öre. Never `number`, never floats.
- All server inputs validated with Zod. No `any`.
- Tests live next to the layer they test (`lib/**/*.test.ts` for unit;
  `tests/integration/**` for DB-touching).
- Lint, typecheck, test, build must pass before the agent finishes.

## Out of scope for Phase 1 (intentionally)

Login, multi-user UI, family workspaces, budget goals, savings goals, loan
tracking, portfolio tracking, FX, mobile app, notifications, recurring-
transaction detection, transaction-edit UI, manual re-categorization UI,
exports.
