BEGIN;

-- Automatikusan (beteg-felvételkor) nyitott epizódok megjelölése.
--
-- Döntés (2026-08-13): új beteg rögzítésekor azonnal nyíljon egy nyitott
-- ellátási epizód a beutaló adataival, STAGE_0 („Első konzultációra vár")
-- stádiummal — így a beteg a felvétel pillanatában megjelenik a pipeline-on,
-- és nem kell külön kattintással epizódot indítani.
--
-- A gyors felvétel űrlap (/patients/new) viszont még csak alap- és személyes
-- adatokat kér: a beutaló orvos / indokolás / etiológia jellemzően KÉSŐBB
-- kerül a kartonra. Ezért az így nyitott epizód „félkész": amíg
--   auto_created = TRUE  ÉS  status = 'open'  ÉS  a stádium még STAGE_0,
-- addig a beteg mentésekor (PUT /api/patients/:id) frissítjük az epizód
-- etiológiáját, címét és okát a friss beutaló-adatokból.
-- Az első stádiumlépés (vagy bármely kézzel indított epizód) után nem nyúlunk
-- hozzá — a kézzel írt „Cím / ok" szöveget sosem írjuk felül.

ALTER TABLE patient_episodes
    ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN patient_episodes.auto_created IS
    'TRUE, ha az epizód beteg-felvételkor automatikusan nyílt (nem kézzel indított). Ilyenkor a beutaló-adatok későbbi pótlása még visszaírható, amíg a stádium STAGE_0.';

COMMIT;
