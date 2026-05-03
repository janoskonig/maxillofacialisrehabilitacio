-- Migration 028: one-hard-next becomes opt-in via feature flag
--
-- Background
-- ----------
-- A `one-hard-next` invariáns (epizódonként legfeljebb 1 jövőbeli „hard"
-- munka-foglalás) eddig kétszer volt kikényszerítve:
--   1) alkalmazás-rétegben:  lib/scheduling-service.ts:checkOneHardNext()
--      → hívja lib/appointment-service.ts és lib/convert-slot-intent.ts
--   2) adatbázis-rétegben:   `idx_appointments_one_hard_next` partial UNIQUE
--      INDEX (definiálva a `migration_scheduling_v2.sql`-ben, frissítve a
--      `024_appointment_chain_reservation.sql`-ben).
--
-- A klinikai gyakorlat ezt túl szigorúnak találta: bizonyos epizódoknál
-- legitim igény több jövőbeli munkafázisú időpont (pl. előzetes előjegyzés)
-- felvétele. A megkerülő utak (`requires_precommit`, `is_chain_reservation`,
-- override-modal admin felhasználóknak) kapcsoló nélkül nehezen kezelhetők.
--
-- Megoldás
-- --------
-- 1) Új feature flag: `enforce_one_hard_next` (default: `false` = a szabály
--    KIKAPCSOLVA). Az alkalmazás-réteg ezt nézi, és csak akkor futtatja a
--    `checkOneHardNext`-et, ha a flag `true`.
-- 2) A partial UNIQUE INDEX eltávolítva. Ha az index a helyén maradna, a
--    Postgres továbbra is dobna `23505 unique_violation`-t a flag állásától
--    függetlenül — tehát a flag nem érne semmit. Az invariánst innentől
--    kizárólag az alkalmazás-réteg védi (flag mögött).
-- 3) A `is_future` / `is_active_status` materializált oszlopok és a
--    `appointments_set_is_future_active` trigger MEGMARAD: olcsók, és
--    visszakapcsoláshoz / diagnosztikához kelletnek (pl.
--    `app/api/scheduling/integrity/route.ts`).
-- 4) Az `idx_appointments_one_hard_next` constraint név megmarad a
--    `lib/appointment-constraint-errors.ts` mapping-jében — backward
--    kompatibilitás miatt (pl. ha valaki visszaállítja az indexet, a
--    fordítás ott van).
--
-- Visszafordítás
-- --------------
-- A flag `true`-ra állítása újra bekapcsolja az alkalmazás-szintű ellenőrzést.
-- Ha ezen felül DB-szintű védelmet is szeretnénk, az indexet a
-- `024_appointment_chain_reservation.sql`-ben látható definícióval
-- helyreállíthatjuk.

BEGIN;

-- (1) Drop the DB-level partial unique index. The application-level check
-- (gated by `enforce_one_hard_next`) is now the single source of truth.
DROP INDEX IF EXISTS idx_appointments_one_hard_next;

-- (2) Seed the new feature flag. Default `false`: rule disabled.
INSERT INTO scheduling_feature_flags (key, enabled) VALUES
    ('enforce_one_hard_next', false)
ON CONFLICT (key) DO NOTHING;

COMMIT;
