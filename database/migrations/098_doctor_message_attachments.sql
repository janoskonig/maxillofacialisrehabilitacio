-- 098: Orvos–orvos chat képmellékletek, amelyeket a küldő NEM rendelt beteghez.
--
-- A beteghez rendelt chat-képek a patient_documents táblába kerülnek (címke:
-- "chat"), és a meglévő [DOCUMENT_UPLOADED:…] markert használják. Ez a tábla
-- csak a beteg nélküli képeket tárolja; az üzenet a [CHAT_IMAGE:<id>] markert
-- hordozza, a fájl az FTP `_chat-attachments` mappájában van.
--
-- message_id: küldéskor kötődik az üzenethez (sendDoctorMessage). NULL, amíg a
-- feltöltött kép még nem lett elküldve (vagy az üzenet törlődött) — ilyenkor
-- csak a feltöltő látja.

BEGIN;

CREATE TABLE IF NOT EXISTS doctor_message_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  UUID REFERENCES doctor_messages(id) ON DELETE SET NULL,
  filename    VARCHAR(500) NOT NULL,
  file_path   VARCHAR(1000) NOT NULL,
  file_size   BIGINT NOT NULL,
  mime_type   VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_message_attachments_message
  ON doctor_message_attachments (message_id);

CREATE INDEX IF NOT EXISTS idx_doctor_message_attachments_uploaded_by
  ON doctor_message_attachments (uploaded_by, created_at DESC);

COMMENT ON TABLE doctor_message_attachments IS
  'Orvos–orvos chatben küldött, beteghez nem rendelt képek (fájl az FTP _chat-attachments mappában).';
COMMENT ON COLUMN doctor_message_attachments.message_id IS
  'A doctor_messages sor, amely a [CHAT_IMAGE:<id>] markert hordozza (NULL = még nem elküldött / törölt üzenet).';

COMMIT;
