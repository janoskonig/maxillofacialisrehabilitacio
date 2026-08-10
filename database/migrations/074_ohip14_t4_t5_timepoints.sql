BEGIN;

-- OHIP-14 timepoint-átrendezés: T0–T5.
--
-- Új ablakok (az átadás — az első STAGE_6 vagy azt követő stádium-esemény —
-- dátumához képest; lib/ohip14-timepoint-stage.ts):
--   T0: protetikai fázis előtt (stádium-kapuzott)
--   T1: közvetlenül átadás után (0. nap)
--   T2: átadás után ~1 hónap  (30. nap)
--   T3: átadás után ~6 hónap  (180. nap)
--   T4: átadás után ~1 év     (365. nap)
--   T5: átadás után ~3 év     (1095. nap)
--
-- A meglévő T0–T3 válaszok változatlanok maradnak; a CHECK bővül T4/T5-tel.
-- (Az ohip_reminder_log.timepoint VARCHAR(2) — a T4/T5 belefér, nem kell
-- módosítani.)

ALTER TABLE ohip14_responses DROP CONSTRAINT IF EXISTS ohip14_responses_timepoint_check;
ALTER TABLE ohip14_responses ADD CONSTRAINT ohip14_responses_timepoint_check
    CHECK (timepoint IN ('T0', 'T1', 'T2', 'T3', 'T4', 'T5'));

COMMENT ON COLUMN ohip14_responses.timepoint IS
    'Timepoint: T0 (protetikai fázis előtt), T1 (közvetlenül átadás után), T2 (átadás +1 hó), T3 (átadás +6 hó), T4 (átadás +1 év), T5 (átadás +3 év)';

COMMIT;
