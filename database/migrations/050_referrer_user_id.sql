BEGIN;

-- Beutaló orvos → felhasználói fiók kapcsolat (FK).
--
-- A `patient_referral.beutalo_orvos` eddig csak szabad szöveges név volt. Ez
-- (a) törékennyé tette a hiányzó-adat emlékeztetők célzását (név-egyezés), és
-- (b) megakadályozta a beutaló orvos / intézmény szerinti statisztikai rétegzést.
-- Additív: a szöveges mezőt megtartjuk, csak egy feloldott user_id FK-t adunk.

ALTER TABLE patient_referral
  ADD COLUMN IF NOT EXISTS beutalo_orvos_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_referral_beutalo_orvos_user_id
  ON patient_referral(beutalo_orvos_user_id);

-- Visszatöltés: csak EGYÉRTELMŰ névegyezésnél (pontosan egy aktív beutaló orvos
-- ugyanazzal a normalizált névvel). A többértelmű neveket nem tippeljük meg.
UPDATE patient_referral pr
   SET beutalo_orvos_user_id = m.id
  FROM (
    SELECT lower(btrim(doktor_neve)) AS nrm, MIN(id::text)::uuid AS id, COUNT(*) AS c
    FROM users
    WHERE role = 'beutalo_orvos'
      AND active IS NOT FALSE
      AND doktor_neve IS NOT NULL
      AND btrim(doktor_neve) <> ''
    GROUP BY lower(btrim(doktor_neve))
    HAVING COUNT(*) = 1
  ) m
 WHERE pr.beutalo_orvos_user_id IS NULL
   AND pr.beutalo_orvos IS NOT NULL
   AND lower(btrim(pr.beutalo_orvos)) = m.nrm;

COMMIT;
