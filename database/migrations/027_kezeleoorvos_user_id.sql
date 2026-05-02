-- Migration 027: kezeleoorvos_user_id (canonical doctor reference for patients)
--
-- Background
-- ----------
-- A `patients.kezeleoorvos VARCHAR(100)` mező eddig az orvos *nevét* tárolta
-- (`users.doktor_neve`-vel egyező string). Ez töréketlen volt: ha egy orvos
-- nevét átírták, a párosítás elveszett. Új SSoT: `kezeleoorvos_user_id` UUID
-- → `users(id)`. A régi VARCHAR mezőt megtartjuk backward-compat miatt; minden
-- jövőbeli írás (recompute service, API write paths) szinkronban tartja a
-- `users.doktor_neve` aktuális értékével.
--
-- Mit rendelünk a beteg „kezelőorvosához"?
--   B-eset: ha van olyan aktív (`status = 'active'`) `patient_episodes` sor,
--           amelyhez van rendelt `assigned_provider_id`, akkor a *legutóbb
--           nyitott* (max `opened_at`) ilyen epizód provider-je nyer.
--   A-eset: ha B nincs, akkor a beteg legközelebbi (now()-hoz időben) nem
--           lemondott / nem elutasított `appointments` sor `dentist_email`
--           mezőjéből feloldott `users(id)` nyer (jövőbeli + max 30 napos
--           múltbeli).
--   Egyik sem: nem írjuk át a meglévő értéket (recompute „nem vonja vissza").
--
-- A teljes recompute logikát a `lib/recompute-kezeleoorvos.ts` service tartja
-- (a write hookok onnan hívják), a backfillt pedig a
-- `scripts/backfill-kezeleoorvos.js` script futtatja.
--
-- Idempotens: ismételten futtatható.

BEGIN;

-- 1) Új oszlop a betegekhez (FK users.id-re).
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS kezeleoorvos_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_patients_kezeleoorvos_user'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    ALTER TABLE patients
      ADD CONSTRAINT fk_patients_kezeleoorvos_user
      FOREIGN KEY (kezeleoorvos_user_id) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN patients.kezeleoorvos_user_id IS
  'Aktuális kezelőorvos user_id (canonical). Recompute logika tartja karban: B-eset = legutóbb nyitott aktív epizód assigned_provider_id, A-eset = legközelebbi nem-cancelled/rejected appointment dentist_email → users.id. Lásd lib/recompute-kezeleoorvos.ts. A régi patients.kezeleoorvos VARCHAR mező backward-compat: minden write-tal együtt frissül a users.doktor_neve aktuális értékére.';

-- 2) Index a gyors lekérdezésekhez (jogosultság check, „nincs kezelőorvosa"
--    worklist, top-orvosok statisztika stb.).
CREATE INDEX IF NOT EXISTS idx_patients_kezeleoorvos_user_id
  ON patients (kezeleoorvos_user_id)
  WHERE kezeleoorvos_user_id IS NOT NULL;

-- A `patients_full` VIEW (005-ös migráció) szándékosan NEM kerül kibővítésre
-- ezzel az új oszloppal. Indok:
--   • A `CREATE OR REPLACE VIEW` szigorú szabálya miatt (létező oszlopok
--     neve/típusa nem változhat, új oszlop csak a végére fűzhető) a teljes
--     definíciót újra kellene gépelni, és minden későbbi 005-módosulás
--     elavulttá tenné ezt a migrációt.
--   • A `kezeleoorvos_user_id` mezőt a recompute service írja közvetlenül
--     a `patients` core táblába, megkerülve a view INSTEAD OF triggereit.
--   • Az olvasó kód (jogosultság check, dashboard worklist, recipient
--     ranking, statisztika) közvetlenül a `patients` táblára JOIN-ol,
--     nem a `patients_full` view-ra hivatkozik.
-- A backward-compat `kezeleoorvos` VARCHAR mező a view-ban változatlanul
-- elérhető marad — UI kijelzéshez ez használható.

COMMIT;
