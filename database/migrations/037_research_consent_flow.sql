-- TMK research consent flow: event history, active consent version seed

ALTER TABLE consent_versions
  ADD COLUMN IF NOT EXISTS consent_body_hu TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS patient_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL
    CHECK (event_type IN ('pending', 'granted', 'withdrawn', 'expired', 'reconsent_requested')),
  consent_version_id UUID REFERENCES consent_versions (id),
  previous_status VARCHAR(32),
  new_status VARCHAR(32) NOT NULL,
  capture_method VARCHAR(32)
    CHECK (capture_method IS NULL OR capture_method IN (
      'written_form', 'verbal_documented', 'patient_portal', 'electronic'
    )),
  actor_id VARCHAR(255),
  actor_email VARCHAR(255),
  reason TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_patient_consent_events_patient
  ON patient_consent_events (patient_id, recorded_at DESC);

-- Default protocol + active consent version (idempotent seed)
INSERT INTO registry_protocols (protocol_code, title, version_label, effective_from)
VALUES (
  'TMK_MAXREHAB',
  'Maxillofaciális rehabilitációs regiszter',
  'v1',
  CURRENT_DATE
)
ON CONFLICT (protocol_code) DO NOTHING;

INSERT INTO consent_versions (
  protocol_id,
  version_label,
  consent_text_hash,
  effective_from,
  consent_body_hu,
  is_active
)
SELECT
  p.id,
  'v1',
  encode(sha256('tmk_research_consent_v1_hu'::bytea), 'hex'),
  CURRENT_DATE,
  $consent$
A beteg hozzájárulását kéri a Maxillofaciális Rehabilitációs Regiszter (TMK) keretében történő anonimizált adatfeldolgozáshoz és kutatási célú felhasználáshoz.

A hozzájárulás önkéntes. A beteg tájékoztatást kap arról, hogy:
- személyes adatai kizárólag a szükséges mértékben kerülnek feldolgozásra;
- kutatási exportok anonimizált formában készülnek;
- a hozzájárulás bármikor visszavonható; a visszavonás a jövőbeli kutatási exportokból zárja ki az érintettet;
- a korábban lezárt, fagyasztott exportok audit célú megőrzése a vonatkozó szabályozás szerint történhet.

A hozzájárulás rögzítése után az adatok a regiszter minőségbiztosítási folyamatában továbbíthatók.
$consent$,
  true
FROM registry_protocols p
WHERE p.protocol_code = 'TMK_MAXREHAB'
  AND NOT EXISTS (
    SELECT 1 FROM consent_versions cv
    WHERE cv.protocol_id = p.id AND cv.version_label = 'v1'
  );

UPDATE consent_versions cv
SET is_active = false
FROM registry_protocols p
WHERE cv.protocol_id = p.id
  AND p.protocol_code = 'TMK_MAXREHAB'
  AND cv.version_label <> 'v1';

UPDATE consent_versions cv
SET is_active = true
FROM registry_protocols p
WHERE cv.protocol_id = p.id
  AND p.protocol_code = 'TMK_MAXREHAB'
  AND cv.version_label = 'v1';
