BEGIN;

-- WP-4.1a: Vizit-séma (FÁZIS 4 — vizit-alapú kezelési terv, "puzzle").
--
-- FELHASZNÁLÓI DÖNTÉS (2026-08-28, terv 2. szakasz 3. pont): a vizit-identitás
-- KÜLÖN `episode_visits` tábla — nem a merge-csoport (primary sor). A
-- `merged_into_episode_work_phase_id` mező átmenetileg MEGMARAD
-- kompatibilitásból; a merge/unmerge route-ok a vizit-tagságot is írják.
--
-- A modell (terv 4.0–4.1):
--   • Egy vizit ("Alkalom") = egy betegvizit-alkalom, amelyre munkafázisok
--     ("kockák") kerülnek. Az EWP sorok `visit_id`-vel tartoznak vizithez.
--   • `days_offset` = vizit-szintű forecast-eltolás ("ennyi nappal az előző
--     alkalom után") — a WP-4.2 köti a forecastba.
--   • `jaw` = állcsont-hatókör a munkafázison ('felso' | 'also' | 'mindketto').
--   • `episode_work_phase_teeth` = több fog egy fázishoz; a mai 1:1
--     `tooth_treatment_id` megmarad visszafelé-kompatibilitásból.
--
-- INVARIÁNS (kód-oldal, WP-4.1a-tól): minden új EWP sor vizitbe születik —
-- alapértelmezés: új egyfős vizit az epizód vizit-listájának végére.

CREATE TABLE IF NOT EXISTS episode_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  label VARCHAR(200),
  planned_duration_minutes INT,
  days_offset INT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_visits_episode_seq
  ON episode_visits (episode_id, seq);

-- updated_at bump — a 062-es migráció közös trigger-függvényével.
DROP TRIGGER IF EXISTS trg_episode_visits_updated_at ON episode_visits;
CREATE TRIGGER trg_episode_visits_updated_at
  BEFORE UPDATE ON episode_visits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE episode_visits IS
  'Betegvizit-alkalom ("Alkalom") a vizit-alapú kezelési tervhez (WP-4.1a). Az episode_work_phases sorok visit_id-vel tartoznak hozzá; a merge-csoport (merged_into_episode_work_phase_id) átmenetileg párhuzamosan él, kompatibilitásból.';
COMMENT ON COLUMN episode_visits.days_offset IS
  'Vizit-szintű forecast-eltolás: ennyi nappal az előző alkalom után. A WP-4.2 köti a forecastba; a backfill a primary fázis default_days_offset-jét veszi át.';
COMMENT ON COLUMN episode_visits.label IS
  'Opcionális vizit-címke; NULL esetén a UI a fázis-címkékből számol.';

-- EWP → vizit tagság.
ALTER TABLE episode_work_phases
  ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES episode_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_episode_work_phases_visit
  ON episode_work_phases (visit_id) WHERE visit_id IS NOT NULL;

-- Állcsont-hatókör a munkafázison (eddig csak az episode_pathways-en volt jaw).
ALTER TABLE episode_work_phases
  ADD COLUMN IF NOT EXISTS jaw VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'episode_work_phases_jaw_check'
      AND conrelid = 'episode_work_phases'::regclass
  ) THEN
    ALTER TABLE episode_work_phases
      ADD CONSTRAINT episode_work_phases_jaw_check
      CHECK (jaw IS NULL OR jaw IN ('felso', 'also', 'mindketto'));
  END IF;
END $$;

COMMENT ON COLUMN episode_work_phases.visit_id IS
  'A fázis vizitje (WP-4.1a). Minden új sor vizitbe születik; a NULL csak történelmi/degradált állapot (a backfill tölti).';
COMMENT ON COLUMN episode_work_phases.jaw IS
  'Állcsont-hatókör: felso | also | mindketto; NULL = nem állcsont-szintű kezelés.';

-- Több fog egy fázishoz — a mai 1:1 tooth_treatment_id MELLÉ, nem helyette.
CREATE TABLE IF NOT EXISTS episode_work_phase_teeth (
  episode_work_phase_id UUID NOT NULL REFERENCES episode_work_phases(id) ON DELETE CASCADE,
  tooth_number VARCHAR(5) NOT NULL,
  PRIMARY KEY (episode_work_phase_id, tooth_number)
);

COMMENT ON TABLE episode_work_phase_teeth IS
  'Fog-hatókör a munkafázison (WP-4.1a): több fog egy fázishoz. Az 1:1 tooth_treatment_id visszafelé-kompatibilitásból megmarad.';

-- ---------------------------------------------------------------------------
-- BACKFILL — set-alapú, idempotens (csak visit_id IS NULL sorokra fut,
-- második futás 0 változás). Újrafuttatható formában ugyanez a SQL él a
-- lib/episode-visits-backfill.ts-ben (scripts/backfill-episode-visits.ts
-- futtatja) — a két helyet együtt kell módosítani.
--
-- Leképezés:
--   • merge-csoport (primary + a rá mutató merged_into gyerekek) → EGY vizit;
--   • magányos primary sor → saját egyfős vizit.
-- A vizit seq-je a primary COALESCE(seq, pathway_order_index) sorrendjét
-- követi (0-tól epizódon belül; ha már vannak vizitek, a meglévő max után
-- folytatódik). days_offset := a primary default_days_offset-je; label NULL.
-- ---------------------------------------------------------------------------

-- 1) Minden vizit nélküli primary (nem-beolvasztott) sor kap saját vizitet.
WITH primaries AS (
  SELECT
    ewp.id AS ewp_id,
    ewp.episode_id,
    ewp.default_days_offset,
    gen_random_uuid() AS visit_id,
    ROW_NUMBER() OVER (
      PARTITION BY ewp.episode_id
      ORDER BY COALESCE(ewp.seq, ewp.pathway_order_index),
               ewp.pathway_order_index, ewp.created_at, ewp.id
    ) - 1 AS rn
  FROM episode_work_phases ewp
  WHERE ewp.visit_id IS NULL
    AND ewp.merged_into_episode_work_phase_id IS NULL
),
base AS (
  SELECT episode_id, MAX(seq) + 1 AS base_seq
  FROM episode_visits
  GROUP BY episode_id
),
inserted AS (
  INSERT INTO episode_visits (id, episode_id, seq, days_offset)
  SELECT p.visit_id, p.episode_id, COALESCE(b.base_seq, 0) + p.rn, p.default_days_offset
  FROM primaries p
  LEFT JOIN base b ON b.episode_id = p.episode_id
)
UPDATE episode_work_phases ewp
SET visit_id = p.visit_id
FROM primaries p
WHERE ewp.id = p.ewp_id;

-- 2) A beolvasztott gyerekek a primary vizitjét kapják.
UPDATE episode_work_phases child
SET visit_id = parent.visit_id
FROM episode_work_phases parent
WHERE child.merged_into_episode_work_phase_id = parent.id
  AND child.episode_id = parent.episode_id
  AND child.visit_id IS NULL
  AND parent.visit_id IS NOT NULL;

COMMIT;
