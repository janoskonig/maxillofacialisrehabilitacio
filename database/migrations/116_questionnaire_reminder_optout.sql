BEGIN;

-- Kérdőív-emlékeztetők leiratkozása.
--
-- Ha a beteg nem kíván OHIP-14 vagy más önkitöltős kérdőívet kitölteni, a
-- buzdító e-maileket (és a hozzájuk tartozó push/portál-feladatot, orvosi
-- eszkalációt) nem kapja meg. A beteg maga a portálon, vagy a személyzet a
-- kartonon kapcsolhatja. A kérdőív önkéntes kitöltése továbbra is lehetséges.
--
-- Nem klinikai adat: az írása a 062-es skip-flaggel történik.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS kerdoiv_emlekezteto_tiltva BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kerdoiv_emlekezteto_tiltva_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kerdoiv_emlekezteto_tiltva_by TEXT;

COMMENT ON COLUMN patients.kerdoiv_emlekezteto_tiltva IS
  'true = a beteg nem kér kérdőív-kitöltésre buzdító emlékeztetőt (OHIP-14, önkitöltés)';
COMMENT ON COLUMN patients.kerdoiv_emlekezteto_tiltva_by IS
  '''patient'' (portálon maga állította) vagy a személyzeti felhasználó e-mail címe';

COMMIT;
