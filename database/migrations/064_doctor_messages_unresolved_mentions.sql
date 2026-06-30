-- 064: Feloldatlan, kétértelmű beteg-említések tárolása az orvos-üzeneteken.
--
-- A szabad-szöveges beteg-felismerés egyértelmű találatait küldéskor automatikusan
-- a `mentioned_patient_ids`-be tesszük. A kétértelmű találatokat (több azonos nevű
-- beteg) viszont nem tippeljük meg: ha a feladó küldés előtt nem választott, az
-- említés ide kerül "feloldatlan" állapotban, és az elküldött üzeneten utólag is
-- feloldható (ki melyik beteg). Feloldáskor az adott bejegyzés kikerül innen, a
-- kiválasztott beteg pedig bekerül a `mentioned_patient_ids`-be.
--
-- Alak (JSONB tömb):
--   [{ "matchedText": "Kovács János", "candidateIds": ["uuid1", "uuid2"] }]

ALTER TABLE doctor_messages
  ADD COLUMN IF NOT EXISTS unresolved_patient_mentions JSONB NOT NULL DEFAULT '[]'::jsonb;
