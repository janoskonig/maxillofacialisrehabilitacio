# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Patient data & care-coordination system for a maxillofacial rehabilitation practice. Despite the README's "local storage" framing (outdated), this is a full **PostgreSQL-backed Next.js 14 (App Router) application with a custom Socket.io server**. The domain language is **Hungarian** — table/column names, enum values, comments, and UI strings are Hungarian, and English is mixed in freely. Preserve this convention; do not "translate" identifiers like `fogpótlástanász`, `beutalo_orvos`, `kezeleoorvos`, or `episode_work_phases`.

`AGENTS.md` is the most accurate quick-start (Cursor Cloud setup). The root `README.md` is stale.

## Commands

```bash
npm run dev          # custom server (tsx server.ts) on :3000 — REQUIRED for Socket.io, not `next dev`
npm run build        # next build (runs ESLint + tsc unless SKIP_BUILD_CHECKS=true)
npm run build:render # build with SKIP_BUILD_CHECKS=true (Render's ~2GB VM OOMs on the lint/TS phase)
npm start            # production: verify-production-build.mjs preflight, then tsx server.ts
npm run lint         # next lint
npm run typecheck    # tsc --noEmit
npm run test         # vitest run (all unit tests)
npm run test:watch   # vitest watch
npm run migrate      # apply all database/migrations in order
```

Run a single test file or a name pattern:

```bash
npx vitest run __tests__/lib/dateUtils.test.ts
npx vitest run -t "rate limit"
```

Postgres must be running before `npm run dev`. On the Cursor Cloud image: `sudo pg_ctlcluster 16 main start`.

## Database & migrations

Two migration systems coexist — understand both before touching schema:

- **`database/legacy/`** (~90 `migration_*.sql` files): the historical, *untracked* migrations that build the original core schema. Applied ad hoc; not run by `npm run migrate`.
- **`database/migrations/`** (`001_*.sql` … `047_*.sql`): the *tracked* migrations. `scripts/run-all-migrations.js` runs them in filename order and records each in a `node_migrations` table so each runs once. **New schema changes go here.** Create one with `npm run migrate:create <name>` (node-pg-migrate, SQL language). Run a single tracked migration: `node scripts/run-all-migrations.js 027_kezeleoorvos_user_id.sql`.

Fresh local setup order: `database/schema.sql` → key legacy migrations (users, episodes, time_slots, treatment_types, etc.) → `npm run migrate`. The `patients_full` VIEW (legacy/migration 005) joins `patients` + referral/anamnesis/dental-status/treatment-plan tables and is depended on widely; the `treatment_types` table must exist for patient creation. See `DATABASE_SETUP.md`, `FIX_DATABASE.md`, and `database/README.md`.

Many `package.json` `migrate:*` / `episode-plan:*` / `backfill:*` / `registry:*` scripts are **one-off data backfills tied to a specific migration** — not part of routine setup. Read the script header before running.

## Architecture

### Request lifecycle
1. **`server.ts`** — custom HTTP server wrapping Next.js; initializes Socket.io (`lib/socket-server.ts`). The custom server is mandatory for WebSockets.
2. **`middleware.ts`** — runs on `/api/*` only. Does IP rate limiting (`lib/rate-limit.ts`; tighter on `/api/auth/*`), lets `PUBLIC_API_PREFIXES` through unauthenticated, and for everything else verifies the JWT and forwards `x-user-id` / `x-user-email` / `x-user-role` headers. It does **not** reject unauthenticated requests — route handlers enforce auth.
3. **Route handlers** — under `app/api/**/route.ts`.

### Auth & route handler conventions
- JWT (jose) is read from the `auth-token` **cookie** or a `Bearer` header (mobile clients). `JWT_SECRET` env var.
- Wrap handlers with the helpers in **`lib/api/route-handler.ts`**: `apiHandler` (public), `authedHandler` (401 if no session), `roleHandler([...roles])` (401/403), `optionalAuthHandler`. They inject a correlation ID, forward route params, and route thrown errors through `handleApiError` (`lib/api-error-handler.ts`). Inside handlers, throw `HttpError(status, message, code)` from `lib/auth-server.ts` rather than building error responses by hand.
- `verifyAuth` / `requireAuth` / `requireRole` (also `lib/auth-server.ts`) are the lower-level primitives.
- **Roles** are `'admin' | 'fogpótlástanász' | 'technikus' | 'beutalo_orvos'` (defined in `lib/auth-server.ts`). Note `lib/roles.ts` is a separate **client-side localStorage** role map used by the frontend — the source of truth for authorization is the JWT/DB role, not `lib/roles.ts`.

### Data access
- **`lib/db.ts`** — `getDbPool()` returns a singleton `pg.Pool` persisted on `globalThis` to survive HMR (prevents dev connection leaks → `53300 too many clients`). Pool size is small by design (`DB_POOL_MAX` default 5) because `workers × pool` must stay under Postgres `max_connections`. Wraps queries with slow-query logging (`SLOW_QUERY_MS`, default 500ms). Use `queryWithRetry` for `53300` resilience.
- **`lib/repositories/`** (`patient`, `episode`, `appointment`, `user`) and **`lib/queries/`** hold shared SQL/field lists (e.g. `PATIENT_SELECT_FIELDS`). Reuse these instead of inlining column lists.

### Domain model (the "big picture")
`lib/` is large and organized by domain rather than layer. Core entities and the flows that tie them together:

- **Patients** → **Episodes** (treatment episodes) → **Care pathways** / **work phases** / **episode steps**. A pathway is a sequence of clinical work phases; the "next step" engine (`lib/next-step-engine.ts`, `lib/episode-forecast.ts`, forecast caches) projects upcoming steps and durations. The **episode-plan** migration (phases 1–6, env-gated via `READ_PLAN_ITEMS` / `WRITE_PLAN_ITEMS` / `SCHEDULER_USE_PLAN_ITEMS`) is an in-progress move from JSON treatment plans to normalized `episode_plan_items`.
- **Scheduling**: time slots → **slot intents** (a desired booking) → **holds** / **chain reservations** → **appointments**. See `lib/scheduling-service.ts`, `lib/slot-intent-projector.ts`, `lib/first-bookable-slot.ts`, worklists, and the expiry workers (`scripts/*-expiry-worker.ts`). Appointment status/attempt taxonomy lives in `lib/appointment-status.ts`, `lib/appointment-attempts.ts`, `lib/booking-error-taxonomy.ts`.
- **Consilium**: multidisciplinary case conferences — sessions, invitations, prep-share tokens, presentation (`lib/consilium*.ts`).
- **Messaging**: doctor↔doctor, doctor groups, and patient↔doctor threads over Socket.io. Rooms are `patient:{id}`, `user:{id}` (auto-joined), `doctor-group:{id}`; ACL is enforced on `join-room` (`lib/socket-server.ts`, `lib/socket-auth.ts`, `lib/messaging/`, `contexts/SocketContext.tsx`).
- **Tasks** (`Feladataim` / todos): personal + delegated, with push and per-task email reminders driven by a cron endpoint.
- **Documents**: upload (optional FTP storage), tagging, annotations, and document-request wizards. Clinical doc requirements in `lib/clinical-rules.ts` (`REQUIRED_DOC_TAGS`).
- **OHIP-14**: oral-health quality-of-life questionnaire with timepoint staging and reminders (`lib/ohip14-*.ts`).
- **Research registry** (`lib/research-registry/`, `data/research-registry/`): consented research data export with quality/governance workers, behind feature flags.

### Frontend
`app/` route segments per feature; `components/` is flat with feature subfolders (`admin/`, `consilium/`, `messaging/`, `mobile/`, `patient-form/`, `patient-portal/`, `staff/`, `widgets/`). React Hook Form + Zod for forms, Tailwind, `@dnd-kit` for drag-drop boards (pipeline/Gantt), `recharts` for charts. Shared client state via React contexts in `contexts/` and hooks in `hooks/`.

### Cross-cutting
- **Sentry**: `sentry.{client,server,edge}.config.ts` + `instrumentation*.ts` (enabled via `next.config.js` instrumentation hook).
- **`next.config.js`**: `removeConsole` strips `console.log`/`info` in production (keeps `error`/`warn`) — debug logs only appear in dev. `SKIP_BUILD_CHECKS=true` disables in-build ESLint/TS (run them in CI instead).
- **Cron**: Render runs `scripts/cron-sync.js` every minute; it does Google Calendar sync and, at specific Europe/Budapest hours, triggers admin daily-summary emails and task reminders. External schedulers authenticate to public cron endpoints via API keys (`GOOGLE_CALENDAR_SYNC_API_KEY`, `TASK_REMINDERS_API_KEY`).

## Environment & deployment

- Node 20 (`.node-version`, `engines`). Copy `.env.example` → `.env.local`. Required minimum: `DATABASE_URL`, `JWT_SECRET`. SMTP, FTP, Google Calendar, and Web Push (VAPID) are optional — the app boots without them but those features are inert.
- `NEXT_PUBLIC_ADMIN_EMAIL` / `NEXT_PUBLIC_ADMIN_PASSWORD` are only login-form *defaults*; real auth is DB-backed (`users` table, bcrypt). Create a user via SQL insert with a bcrypt hash.
- Deploys to **Render** via `Dockerfile` (web service `npm start`) + a cron service. See `RENDER_DEPLOYMENT.md`. Feature flags and worker env vars are documented inline in `.env.example`.

## Testing

Vitest with `happy-dom`, globals on, `@` → repo root (`vitest.config.ts`). Tests live in `__tests__/{lib,api}/` and as `*.test.ts(x)` anywhere. They're unit/logic tests (taxonomies, reducers, pure helpers, route-handler behavior) — they do not spin up Postgres, so keep new tests pure or mock the DB.
