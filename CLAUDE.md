# CLAUDE.md — tekonomy

> This file is the contract every coding agent obeys when working this repo.
> Read it first, follow it exactly. When in doubt, also read `docs/ARCHITECTURE.md`.

## What this project is

Self-hosted personal-economy app. Upload bank-statement CSVs, see where money
goes, set budget and savings goals, track loans and investments. Phase 1
(this scope) ships: CSV upload → transaction list → spending dashboard for a
single user / single personal workspace. The full plan lives in
`docs/ARCHITECTURE.md` — read it before starting any non-trivial issue.

## Stack

- Node.js **22 LTS** (see `.nvmrc`)
- TypeScript **strict**
- Next.js 16 (App Router), React 19, full-stack (UI + API routes in one process)
- PostgreSQL 16 via Prisma 7
- Tailwind CSS v4 + shadcn/ui (added in the issue that needs it)
- Vitest (unit + integration), Playwright (CI-only E2E, added later)
- ESLint + Prettier
- pnpm (see `packageManager` in `package.json`)

## Commands (exact — use these literally)

| Action          | Command                                                 |
| --------------- | ------------------------------------------------------- |
| Install         | `pnpm install --frozen-lockfile`                        |
| Dev server      | `pnpm dev`                                              |
| Build           | `pnpm build`                                            |
| Lint            | `pnpm lint`                                             |
| Format check    | `pnpm format:check`                                     |
| Format write    | `pnpm format`                                           |
| Typecheck       | `pnpm typecheck`                                        |
| Unit tests      | `pnpm test`                                             |
| DB: dev up      | `docker compose -f docker/docker-compose.dev.yml up -d` |
| DB: migrate dev | `pnpm prisma migrate dev`                               |
| DB: generate    | `pnpm prisma generate`                                  |
| Seed            | `pnpm prisma db seed`                                   |
| E2E             | _added in a later issue; do NOT run locally._           |

**Before finishing any issue, every one of these must pass:**
`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
If your change requires a DB schema migration, also commit the generated
`prisma/migrations/**` files.

## Directory layout

```
tekonomy/
├── app/                    # Next.js App Router (UI + API routes)
│   ├── (dashboard)/        # authenticated app shell (post-scaffold issues add this)
│   └── api/                # route handlers
├── components/             # React components
│   ├── ui/                 # shadcn primitives
│   └── …                   # feature components
├── lib/                    # server + shared logic; ALL business logic lives here
│   ├── db/                 # prisma client singleton (added with the schema issue)
│   ├── domain/             # categorization, dedupe, stats — pure where possible
│   ├── importers/          # one dir per bank profile + registry
│   └── workspace.ts        # currentWorkspaceId() — Phase 1 stub, do not refactor
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── tests/
│   ├── unit/               # extra unit tests not colocated with code
│   └── integration/        # DB-touching; spin up Postgres in setup
├── e2e/                    # Playwright (later issue)
├── docker/
│   ├── docker-compose.dev.yml  # local dev DB
│   └── …                   # production Dockerfile & compose (later issue)
├── docs/
│   └── ARCHITECTURE.md
└── .github/workflows/ci.yml
```

The orchestrator gives every issue an `Agent-Paths:` glob list. **Do not
touch files outside that list.** If you find you need to, stop and raise a
FOLLOWUP (see "Out of scope" below).

## Code style

- **TypeScript strict.** No `any`, no `// @ts-ignore`, no `// @ts-expect-error`
  without an inline comment explaining why.
- **Money is `BigInt` minor units (öre).** Never `number`, never floats, never
  string-formatted decimals in computation. The DB column type is `BigInt`.
- **Zod at every server boundary.** Every API route handler validates its
  input with Zod before touching domain code. Every `lib/importers/**`
  bank profile validates its parsed row with Zod.
- **No singletons except the Prisma client.** Use `lib/db/client.ts`.
- **No fetching in components.** Server Components / route handlers fetch via
  `lib/**`; client components receive data as props or via `use()`.
- **Imports**: use the `@/*` alias (configured in `tsconfig.json`); no deep
  relative paths (`../../../`).
- **Naming**: files `kebab-case.ts`, exported types/components `PascalCase`,
  variables `camelCase`, constants `SCREAMING_SNAKE_CASE`.
- **Comments**: only for non-obvious _why_. Never narrate _what_ the code does.
- **No new dependencies without a clear need.** Prefer the standard library
  and what's already installed. If you do add one, justify it in the PR body.

## Tests

- Unit tests live next to the code: `lib/x/foo.ts` → `lib/x/foo.test.ts`.
  Vitest picks these up from `lib/**/*.test.ts`.
- Integration tests (anything that touches the DB) live in
  `tests/integration/**/*.test.ts` and must use a real Postgres
  (testcontainers or the dev compose). No mocking Prisma.
- Every new module ships with tests. Every bugfix ships with the failing
  test that proves the fix.
- Money: every test that involves amounts asserts in **öre**, not kronor.

## Commits & PRs

- One issue → one branch → one PR. The orchestrator handles branch naming
  (`sortie/issue-N`) and PR creation. **Do not push or open PRs yourself.**
- Commit format: `<type>(<scope>): <summary>, refs #<N>` where `<type>` is one
  of `feat | fix | chore | refactor | test | docs | build | ci`. Example:
  `feat(importer): add SEB Privatkonto profile, refs #6`.
- Reference the issue in every commit on the branch.
- Keep commits focused; multiple small commits in one PR are fine if they
  each tell part of the story.

## Domain conventions

- **Workspaces are first-class even in Phase 1.** Every domain table has a
  `workspaceId` FK. Every query filters by `workspaceId`. The current
  workspace ID comes from `lib/workspace.ts` (`currentWorkspaceId()`) —
  in Phase 1 it returns a constant; in Phase 2 it'll read from the auth
  session. Do not bypass it.
- **Dedupe key**: `sha256(bookedAt.toISOString() + '|' + amountMinor + '|' +
descriptionNorm)`, unique per `(workspaceId, accountId)`.
- **`descriptionNorm`**: `descriptionRaw.toLowerCase().trim()` with trailing
  `/YY-MM-DD` date suffix stripped (regex: `/\/\d{2}-\d{2}-\d{2}$/`).
- **SEB amount parsing**: `Belopp` field uses `.` as thousands separator with
  no decimals. Parser: strip dots → `parseInt(..., 10)` → multiply by `100`
  to get öre. Sign preserved from source. `"-12.000"` → −1200 öre.
  `"44983.000"` → 4 498 300 öre.

## Never do this

- **Don't edit files outside the issue's `Agent-Paths:` scope.** Raise a
  FOLLOWUP instead (see below).
- **Don't push, open PRs, or touch git remotes.** The orchestrator does that.
- **Don't `git rebase`, `git reset --hard`, or otherwise rewrite history.**
- **Don't add a new top-level dependency without justifying it.**
- **Don't store money as `number` or `Decimal`.** Always `BigInt` öre.
- **Don't query the DB without filtering by `workspaceId`.**
- **Don't run `pnpm e2e` / Playwright locally.** It's CI-only.
- **Don't commit `.env`, secrets, or anything from `prisma/migrations/`
  generated by a partial migration.** Only commit clean, full migrations.
- **Don't disable a lint rule or `@ts-expect-error` to make a problem go
  away.** Fix the underlying issue, or raise it as a FOLLOWUP.
- **Don't refactor `lib/workspace.ts` to read from auth.** That's a Phase-2
  issue.
- **Don't write a `README.md` for the project** unless the issue specifically
  asks for it.

## Out of scope handling

If you find work that needs doing but is outside your issue's `Agent-Paths`,
end your run by writing a line beginning with:

```
FOLLOWUP: <short title> :: <one-sentence description with file path>
```

If your issue is impossible to complete as written (missing info,
contradictory requirements, broken upstream), prefix your final message:

```
BLOCKED: <why>
```

Do not partially complete an issue or ship dead code to "leave room" for
future work.
