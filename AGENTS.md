# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

This is a Next.js 14 (App Router) application with a custom HTTP server (`tsx server.ts`) that integrates Socket.io for real-time features. It uses PostgreSQL as its database.

| Service | How to run | Notes |
|---------|-----------|-------|
| **Next.js + Socket.io** | `npm run dev` | Custom server on port 3000 |
| **PostgreSQL** | `sudo pg_ctlcluster 16 main start` | Must be running before dev server |

### Development commands

- **Dev server**: `npm run dev` (starts on http://localhost:3000)
- **Lint**: `npm run lint`
- **Tests**: `npm run test` (vitest, all unit tests)
- **Build**: `npm run build`
- **Migrations**: `npm run migrate`

### Database setup caveats

- The database has a complex migration history. The `database/legacy/` folder contains ~92 legacy migrations that create the core schema, and `database/migrations/` contains tracked migrations (001–041) managed by `scripts/run-all-migrations.js`.
- For a fresh local setup, you must apply `database/schema.sql` first, then key legacy migrations (users, episodes, time_slots, etc.), and finally the tracked migrations.
- The `patients_full` VIEW (created by migration 005) is critical — it joins `patients`, `patient_referral`, `patient_anamnesis`, `patient_dental_status`, and `patient_treatment_plans`.
- The `treatment_types` table (from `database/legacy/migration_reason_treatment_type.sql`) must exist for patient creation to work.

### Authentication

- Login authenticates against the `users` table (bcrypt password hashes).
- Admin credentials in `.env.local`: `NEXT_PUBLIC_ADMIN_EMAIL` / `NEXT_PUBLIC_ADMIN_PASSWORD` — these are only used by the frontend login form as defaults; actual auth is DB-backed.
- Create a user with: `INSERT INTO users (email, password_hash, role, active) VALUES ('admin@example.com', '<bcrypt hash>', 'admin', true);`

### Environment variables

Minimal required `.env.local`:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/maxillofacial_rehab
JWT_SECRET=<any-random-string>
NEXT_PUBLIC_ADMIN_EMAIL=admin@example.com
NEXT_PUBLIC_ADMIN_PASSWORD=changeme
```

### Known gotchas

- The `removeConsole` compiler option in `next.config.js` strips `console.log`/`console.info` in production builds (keeps error/warn). Debug logs only show in dev mode.
- Socket.io is initialized in `server.ts`; the custom server is required for WebSocket support.
- SMTP, FTP, Google Calendar, and Web Push are optional — the app starts fine without them but some features (email notifications, document storage, calendar sync) won't function.
