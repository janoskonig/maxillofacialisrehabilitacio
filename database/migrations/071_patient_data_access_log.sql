BEGIN;

-- EüAK (1997. évi XLVII. tv.) betekintési napló: a személyzet által végzett
-- beteg-adat OLVASÁSOK naplója. Az egészségügyi adatvédelmi törvény elvárja,
-- hogy nyomon követhető legyen, ki, mikor, melyik beteg egészségügyi adatához
-- fért hozzá. Az írásokat (állapotváltozásokat) a patient_changes /
-- audit_events már fedi — ez a tábla kizárólag a betekintést (GET) rögzíti.
--
-- Külön tábla az audit_events-től: a betekintés lényegesen nagyobb volumenű,
-- nincs old/new állapot-payloadja, és eltérő megőrzési ideje lehet.

CREATE TABLE IF NOT EXISTS patient_data_access_log (
  id BIGSERIAL PRIMARY KEY,
  -- Szándékosan NINCS FK a patients-re: a betekintési naplónak túl kell élnie a
  -- beteg GDPR-törlését (Art. 17). Egy FK vagy blokkolná a hard delete-et, vagy
  -- kaszkádolva kitörölné magát a naplót.
  patient_id UUID NOT NULL,
  actor_user_id VARCHAR(255),
  actor_email VARCHAR(255) NOT NULL,
  actor_role VARCHAR(32),
  route VARCHAR(255) NOT NULL,            -- normalizált útvonal, pl. /api/patients/:id/episodes
  method VARCHAR(8) NOT NULL DEFAULT 'GET',
  correlation_id VARCHAR(64),
  ip_address INET,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pdal_patient
  ON patient_data_access_log (patient_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdal_actor
  ON patient_data_access_log (actor_email, accessed_at DESC);

COMMENT ON TABLE patient_data_access_log IS
  'EüAK betekintési napló — beteg-adat olvasások; append-only. Megőrzési idő: DPO-döntésre vár.';

COMMIT;
