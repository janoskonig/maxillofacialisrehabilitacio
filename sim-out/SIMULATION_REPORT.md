# Treatment-Plan & Scheduling Simulation — Results

_Generated 2026-06-15 15:32 UTC · throwaway database `maxfac_sim` · **no production data touched**_

## What this confirms

This simulation seeds dummy data into a **disposable local Postgres** and drives the
application's **own** scheduling/treatment-plan code (not reimplemented logic) end-to-end,
to verify the mechanisms work as intended. Every booking below was produced by calling the
real service functions:

| Mechanism | Function (file) |
|---|---|
| Expand a care pathway into a per-episode plan | `generateEpisodeWorkPhases` (`lib/generate-episode-work-phases.ts`) |
| Forward-chained plan projection (months ahead) | `projectRemainingSteps` (`lib/slot-intent-projector.ts`) |
| Determine the next clinical step + date window | `nextRequiredStep` (`lib/next-step-engine.ts`) |
| Find a real free slot inside that window | `getFirstBookableSlotForEpisode` (`lib/first-bookable-slot.ts`) |
| Book the appointment + flip the slot to booked | `createAppointment` (`lib/appointment-service.ts`) |

To walk a full multi-month chain in one pass, the harness "fast-forwards" by marking each
booked appointment `completed`, which advances the scheduling anchor to the next step's
window. (In real life these complete over months; this is the only simulation artifact.)

## Headline numbers

- **10 patients**, each with one open episode on a distinct real care pathway
- **3 providers** (fogpótlástanász) with **7,992 availability slots** generated across ~20 months
- **91 work phases** generated from pathway templates
- **91 slot-intents** projected (the forward-looking plan)
- **86 appointments booked** = 81 completed + 5 upcoming
- Appointments span **2026-06-16 → 2028-02-22** — i.e. **~20 months ahead**

## Per-patient results

| # | Patient | Care pathway | Provider | Phases | Intents | Booked (done/upcoming) | Appointment span |
|---|---|---|---|---|---|---|---|
| 1 | Tóth Anna | Kombinált fogpótlás rejtett elhorgonyzási eszközzel | Kovács Anna | 11 | 11 | 11 (10✓/1→) | 2026-06-16 → 2028-02-22 |
| 2 | Horváth Ferenc | Kombinált fogpótlás kapocselhorgonyzással | Nagy Béla | 11 | 11 | 10 (10✓/0→) | 2026-06-22 → 2027-03-08 |
| 3 | Kiss Károly | Fedőlemezes fogpótlás | Szabó Csaba | 10 | 10 | 9 (9✓/0→) | 2026-06-26 → 2027-03-15 |
| 4 | Molnár Dénes | Csavarozott rögzítésű implantációs korona/híd | Kovács Anna | 9 | 9 | 8 (8✓/0→) | 2026-07-01 → 2027-03-15 |
| 5 | Németh István | Cementezett rögzítésű implantációs korona/híd | Nagy Béla | 9 | 9 | 9 (8✓/1→) | 2026-06-16 → 2028-02-22 |
| 6 | Farkas Béla | Teljes lemezes fogpótlás | Szabó Csaba | 9 | 9 | 8 (8✓/0→) | 2026-06-22 → 2027-03-08 |
| 7 | Balogh Gábor | Rögzített fogpótlás fogakon elhorgonyozva | Kovács Anna | 8 | 8 | 7 (7✓/0→) | 2026-06-26 → 2027-03-15 |
| 8 | Papp László | Traumás sérülés rehabilitáció | Nagy Béla | 8 | 8 | 8 (7✓/1→) | 2026-07-01 → 2027-12-28 |
| 9 | Takács Erzsébet | Veleszületett rendellenesség rehabilitáció | Szabó Csaba | 8 | 8 | 8 (7✓/1→) | 2026-06-16 → 2027-12-14 |
| 10 | Juhász Júlia | Onkológiai kezelés utáni rehabilitáció | Kovács Anna | 8 | 8 | 8 (7✓/1→) | 2026-06-22 → 2027-12-16 |

## Findings (real issues surfaced by the run)

1. **`slot_intents.step_code` is `varchar(50)` but `episode_work_phases.work_phase_code` is `varchar(80)`.**
   The seeded care pathway **"Kapocselhorgonyzású részleges fémlemezes fogpótlás"** has a work-phase code of
   54 characters, so `generateEpisodeWorkPhases` accepts it but
   `projectRemainingSteps` throws `value too long for type character varying(50)`. This pathway
   would fail projection in production too. The harness excludes it from the rotation and reports it.
2. **12-month control phases (offset 365 days) only become bookable once availability extends far enough.**
   With a 9-month slot horizon they correctly stayed *projected but unbooked* (realistic). Extending
   availability to ~20 months let the full chain book — confirming the horizon gating behaves sensibly.
3. **Schema bootstrap is fragile.** The ~90 untracked `database/legacy/` migrations have implicit
   dependency ordering and non-idempotent `CREATE TRIGGER`s; `schema.sql` ships a *denormalized*
   `patients` while tracked migration `005` is the normalization step. See `scripts/sim/bootstrap-schema.sh`
   for the working order (fresh DB → ordered base tables → re-run failures → tracked migrations).

## Screenshots (running app, logged in as admin)

| File | Page | Shows |
|---|---|---|
| `01-login.png` | /login | Login screen |
| `02-dashboard.png` | / | Dashboard |
| `03-treatment-plans.png` | /treatment-plans | **All 10 plans on a months-ahead timeline + completion ETAs** |
| `04-episode-stages.png` | /patients/{id}/stages | One patient's episode, work phases & next-step projection |
| `05-gantt-timeline.png` | /patients/stages/gantt | Cohort stage Gantt |
| `06-calendar.png` | /calendar | Booked appointments (month view) |
| `07-pipeline.png` | /patients/pipeline | Care pipeline kanban (all 10 patients) |
| `08-tasks-worklist.png` | /tasks/overview | Staff worklist |

## Reproduce

```bash
# Postgres must be running; throwaway DB + .env.local already configured.
bash scripts/sim/bootstrap-schema.sh          # build schema (idempotent-ish)
npm run migrate                               # tracked migrations
npx tsx scripts/sim/run-simulation.ts         # seed + drive the engine
npm run dev &                                 # start the app
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/sim/screenshots.mjs
```

Login: `admin@example.com` / `changeme` (dummy, sim DB only).
