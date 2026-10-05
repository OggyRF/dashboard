# HI Digital team dashboard

Internal web app for HI Digital Solution LLP: attendance, clients, tasks, off-page tracking,
client chat, and the SEO and GMB performance dashboard. The full plan is the
[architecture document](https://claude.ai/code/artifact/5702f8c9-def6-43e9-b62d-11341e2a4087).

**Status: Phase 1 done.** Login, roles, team management and the audit log (Phase 0), plus
attendance, leave and messages to the owners (Phase 1). Every other sidebar item shows the
phase it arrives in.

What the team can do now: log in, take breaks and log out, with the day's totals kept
automatically; see their own monthly record (read-only); apply for leave on a calendar;
message the owners privately. Owners also get a live team board, each person's monthly sheet
with CSV download, corrections with a reason (originals are never overwritten), leave
approvals and a holiday list.

## Stack

Next.js 16 (TypeScript, App Router) · PostgreSQL 16 · Prisma 7 · pg-boss worker ·
Tailwind CSS 4 (brand colours in `src/app/globals.css`) · Vitest · Docker Compose with Caddy for HTTPS.

## Run it locally

Needs Node 22 and PostgreSQL 16 (or Docker for the database).

```bash
npm install                                   # also generates the Prisma client
cp .env.example .env                          # then edit DATABASE_URL if needed
docker compose -f docker-compose.dev.yml up -d   # optional: local PostgreSQL
npm run db:migrate                            # create the tables
npm run create-owner -- --name "Aarif" --email you@example.com   # prints a temporary password
npm run dev                                   # http://localhost:3000
npm run worker                                # background jobs, in a second terminal
```

Sign in with the temporary password; the app asks for a new one straight away.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app with live reload |
| `npm run worker` | Background job worker (scheduled syncs and clean-up) |
| `npm test` | Unit and integration tests (needs PostgreSQL; uses the `hidigital_test` database or `TEST_DATABASE_URL`) |
| `npm run lint` / `npm run typecheck` | Code checks, also run in CI |
| `npm run build` | Production build |
| `npm run db:migrate` | Create a migration after changing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply migrations in production |
| `npm run create-owner` | Create the first owner on an empty database |
| `npm run demo-seed` | Fill a development database with the team and a day of activity (never run on production) |

## Where things live

| Path | Contents |
| --- | --- |
| `prisma/schema.prisma` | Database schema; each phase adds its models here |
| `src/services/` | Business logic: validation, permission checks, database writes, audit rows |
| `src/server/actions/` | Server actions called by forms; thin wrappers over services |
| `src/lib/auth/` | Passwords (argon2id), session tokens, the permission matrix |
| `src/app/(app)/` | Signed-in pages with the sidebar layout |
| `src/worker/` | pg-boss worker and its scheduled jobs |
| `tests/` | Vitest tests, including the full role permission matrix |
| `deploy/`, `Dockerfile`, `docker-compose.yml` | Production deployment |
| `docs/deploy.md` | Server, DNS and backup set-up |
| `docs/preview-hosting.md` | Free live preview on Vercel + Neon, and first-time setup |

## Rules the code follows

- Pages and actions never query the database directly; they call a service.
- Every service checks permissions with `can(role, permission)` from `src/lib/auth/permissions.ts`.
  The table in `tests/permissions.test.ts` must be updated deliberately when access changes.
- Every change writes an audit row in the same transaction (`writeAudit`).
- Times are stored in UTC and shown in India time (`Asia/Kolkata`); calendar days are India days.
- Attendance times always come from the server clock. Recorded entries are append-only: an
  owner's correction is stored beside them and applied on top, never over them.
- No secrets in code or in the repository. See `.env.example` for the names.
