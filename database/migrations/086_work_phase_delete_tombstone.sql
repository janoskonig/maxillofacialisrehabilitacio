BEGIN;

-- WP-0.7 (kódaudit #01): törlés-tombstone az episode_work_phases-hez.
--
-- A generate (lib/generate-episode-work-phases.ts) idempotencia-őre eddig csak
-- azt kérdezte, "létezik-e MOST sor" — ha az orvos a terv minden fázisát
-- törölte, a következő generálás a teljes sablont újra beszúrta, a törölt
-- fog-fázisokat pedig a fog-szinkron tette vissza. A törlés valódi DELETE
-- marad (konzisztensen a 078-as FK-feloldással és a 084-es audit-tombstone-nal:
-- az élő táblákban nincs "halott" sor, a túlélő nyom külön táblában van) —
-- ez a tábla csak azt jegyzi fel, MI lett törölve, hogy az újra-generálás
-- ne támassza fel.
--
-- Olvasói:
--   • generate sablon-őr: source_episode_pathway_id szerint (törölt sablon-fázis
--     nem "hiányzó", nem generálandó újra);
--   • generate fog-szinkron: tooth_treatment_id szerint (törölt fog-fázis nem
--     kerül vissza automatikusan — kézzel, a Fogkezelés fülről továbbra is
--     hozzáadható).
--
-- FK-szemantika (szándékos):
--   • episode_id ON DELETE CASCADE — az epizóddal a tombstone is mehet;
--   • source_episode_pathway_id ON DELETE CASCADE — a sablon eltávolításakor a
--     sablon-fázisok tombstone-jai is mennek, így az ÚJRA alkalmazott sablon
--     tiszta lappal generálódik (ez a kívánt viselkedés);
--   • tooth_treatment_id ON DELETE CASCADE — a fogkezelési igény törlésével a
--     tombstone tárgytalan.

CREATE TABLE IF NOT EXISTS episode_work_phase_tombstones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
  work_phase_code VARCHAR(80),
  tooth_treatment_id UUID REFERENCES tooth_treatments(id) ON DELETE CASCADE,
  source_episode_pathway_id UUID REFERENCES episode_pathways(id) ON DELETE CASCADE,
  deleted_by VARCHAR(255),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ewp_tombstones_episode
  ON episode_work_phase_tombstones (episode_id);

CREATE INDEX IF NOT EXISTS idx_ewp_tombstones_source
  ON episode_work_phase_tombstones (source_episode_pathway_id)
  WHERE source_episode_pathway_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ewp_tombstones_tooth
  ON episode_work_phase_tombstones (tooth_treatment_id)
  WHERE tooth_treatment_id IS NOT NULL;

COMMENT ON TABLE episode_work_phase_tombstones IS
  'Törölt episode_work_phases sorok kulcsai (WP-0.7, kódaudit #01). A törlés valódi DELETE marad; ez a tábla csak az újra-generálás (generate sablon-őr + fog-szinkron) ellen véd. Az episode_work_phase_audit a "ki/mikor/miért" napló — ez itt a gépi anti-resurrection kulcs.';
COMMENT ON COLUMN episode_work_phase_tombstones.source_episode_pathway_id IS
  'A törölt fázis sablon-forrása; a sablon eltávolításakor CASCADE-del törlődik, hogy az újra alkalmazott sablon tiszta lappal generálódjon.';
COMMENT ON COLUMN episode_work_phase_tombstones.tooth_treatment_id IS
  'A törölt fog-fázis fogkezelési igénye; a fog-szinkron ezt kihagyja, kézi újra-hozzáadás továbbra is lehetséges.';

COMMIT;
