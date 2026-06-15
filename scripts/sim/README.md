# Treatment-plan & scheduling simulation harness

Seeds dummy data into a **throwaway** Postgres database and drives the app's **own**
scheduling/treatment-plan code end-to-end to confirm the mechanisms work — without
touching any production data. Produces screenshots of the running app and a written
report under `sim-out/`.

> This is a verification/demo harness. It is safe to delete. It writes only to the
> disposable `maxfac_sim` database configured in `.env.local`.

## Files

- `bootstrap-schema.sh` — builds the schema on a fresh DB: `schema.sql` → ordered base
  legacy migrations → remaining legacy migrations (re-running only the ones that fail,
  so non-idempotent triggers don't break it). Run `npm run migrate` afterwards for the
  tracked migrations. Excludes the destructive `*rollback*` / `*recreate*` legacy files.
- `run-simulation.ts` — resets sim data, seeds 3 providers + 10 patients + episodes on
  real care pathways, generates ~20 months of provider availability, then for each
  episode calls `generateEpisodeWorkPhases` → `projectRemainingSteps` → (`nextRequiredStep`
  → `getFirstBookableSlotForEpisode` → `createAppointment`) to book the full chain.
  Writes `sim-out/simulation-report.json`.
- `screenshots.mjs` — logs in as admin and screenshots the key pages to `sim-out/`.

## Run

```bash
sudo pg_ctlcluster 16 main start                 # ensure Postgres is up
bash scripts/sim/bootstrap-schema.sh             # fresh-DB schema (see DB setup below)
npm run migrate                                  # tracked migrations
npx tsx scripts/sim/run-simulation.ts            # seed + drive the engine
npm run dev &                                    # start the app on :3000
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/sim/screenshots.mjs
```

## Throwaway DB setup (one-time)

```sql
CREATE ROLE maxfac WITH LOGIN PASSWORD 'REDACTED_LOCAL_DEV_PW' SUPERUSER;
CREATE DATABASE maxfac_sim OWNER maxfac;
```

`.env.local` (gitignored) points `DATABASE_URL` at `maxfac_sim`. Login: `admin@example.com` / `changeme`.
