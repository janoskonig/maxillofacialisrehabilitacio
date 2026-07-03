BEGIN;

-- Beteg-duplikátum ellenőrzés indexei.
--
-- A gyors felvétel közbeni proaktív duplikátum-keresés két lekérdezést futtat:
--  1. normalizált TAJ egyezés: REPLACE(taj, '-', '') = $1
--     (ugyanezt használja a POST /api/patients 409-es blokkja is);
--  2. azonos születési dátumú jelöltek listázása (a név-hasonlóság
--     alkalmazás-oldalon szűr).
-- Mindkettőhöz kifejezés- ill. oszlopindex kell, hogy a betegszám
-- növekedésével se lassuljon a felvételi űrlap.

CREATE INDEX IF NOT EXISTS idx_patients_taj_normalized
  ON patients ((REPLACE(taj, '-', '')))
  WHERE taj IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_szuletesi_datum
  ON patients (szuletesi_datum)
  WHERE szuletesi_datum IS NOT NULL;

COMMIT;
