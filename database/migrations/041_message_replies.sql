-- 041_message_replies.sql
-- Szelet 0.1 — Reply támogatás mindkét üzenetcsatornán.
--
-- Új mező: reply_to_message_id (UUID, nullable, ugyanazon táblára mutat).
-- Channel-szeparáció biztosítása: minden tábla saját magára hivatkozik —
-- cross-channel reply (pl. orvos–orvos válasz beteg üzenetre) tehát
-- adatmodell szinten kizárt.
--
-- ON DELETE SET NULL: ha a hivatkozott eredeti üzenet később törlésre
-- kerül (akár soft, akár hard), a válasz maga megmarad, csak a quote
-- válik árvává. Audit szempontból ez a kívánt viselkedés — soha nem
-- veszítünk válaszüzenetet egy "elromlott" idézet miatt.
--
-- A részleges index (WHERE reply_to_message_id IS NOT NULL) gyors
-- lookupot ad: "egy üzenetre ki válaszolt?" — szál-számláláshoz és
-- Fázis 1+ thread UI-hoz egyaránt használjuk.

BEGIN;

-- 1. Beteg–orvos csatorna (messages tábla)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID
    REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to_message_id
  ON messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

COMMENT ON COLUMN messages.reply_to_message_id IS
  'Válasz target: hivatkozott eredeti messages.id (beteg–orvos csatorna). NULL ha nem reply. ON DELETE SET NULL: idézet elveszhet, válasz megmarad.';

-- 2. Orvos–orvos / csoport csatorna (doctor_messages tábla)
ALTER TABLE doctor_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID
    REFERENCES doctor_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_messages_reply_to_message_id
  ON doctor_messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

COMMENT ON COLUMN doctor_messages.reply_to_message_id IS
  'Válasz target: hivatkozott eredeti doctor_messages.id (orvos–orvos / csoport csatorna). NULL ha nem reply. ON DELETE SET NULL.';

COMMIT;
