-- 042_message_delivery.sql
-- Slice 0.8 — Idempotens küldés + delivery állapot mindkét üzenetcsatornán.
--
-- Új mezők (mindkét táblán):
--   client_message_id TEXT   — kliens által generált UUID/string; ha a
--                              backend ugyanazzal a (sender_id, client_message_id)
--                              párral kap második POST-ot, az eredeti üzenetet
--                              adja vissza (idempotencia).
--   delivery_status   TEXT   — szerveroldali utolsó ismert állapot. A 0.8
--                              kliense csak `sent`-ben rögzít; a `failed` /
--                              `pending` állapotok kliens-oldali UI állapotok.
--                              A `delivered` / `read` állapotok későbbi
--                              szeleteknek vannak fenntartva (Fázis 1+).
--   failed_reason     TEXT   — szerver-rögzített hiba (opcionális).
--
-- UNIQUE constraint: (sender_id, client_message_id) WHERE client_message_id IS NOT NULL.
-- Külön sender_id-k ugyanazt a kliens-ID-t használhatják ütközés nélkül; ugyanannak
-- a sendernek a dupla POST-ja viszont 23505-tel csap meg, amit a hívó réteg fog
-- át és visszaadja az eredeti sort (idempotens viselkedés).

BEGIN;

-- 1. messages (beteg–orvos)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status   TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS failed_reason     TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id_per_sender
  ON messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

COMMENT ON COLUMN messages.client_message_id IS
  'Kliens-oldali idempotencia kulcs (UUID/string). UNIQUE (sender_id, client_message_id) — dupla POST → eredeti sor visszaadva.';
COMMENT ON COLUMN messages.delivery_status IS
  'Szerveroldali utolsó ismert kézbesítési állapot: sent|delivered|read|failed. A klienst-only pending csak UI állapot.';

-- 2. doctor_messages (orvos–orvos / csoport)
ALTER TABLE doctor_messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status   TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS failed_reason     TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_messages_client_id_per_sender
  ON doctor_messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

COMMENT ON COLUMN doctor_messages.client_message_id IS
  'Kliens-oldali idempotencia kulcs. UNIQUE (sender_id, client_message_id).';
COMMENT ON COLUMN doctor_messages.delivery_status IS
  'Szerveroldali utolsó ismert kézbesítési állapot: sent|delivered|read|failed.';

COMMIT;
