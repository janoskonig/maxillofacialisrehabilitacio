BEGIN;

-- Beutaló intézmények törzstáblája.
--
-- Eddig az űrlap-autocomplete a users.intezmeny DISTINCT értékeiből élt
-- (plusz egy nem használt hardcoded lista a lib/types/patient.ts-ben).
-- Mostantól admin által kezelt törzs: hozzáadás / átnevezés / inaktiválás
-- (hard delete nincs — a korábbi beutalók szabad szöveges hivatkozásai
-- érintetlenek maradnak, az inaktív intézmény csak az autocomplete-ből
-- tűnik el).

CREATE TABLE IF NOT EXISTS referral_institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255)
);

-- Név-egyediség kisbetű/térköz-toleranciával.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_institutions_name_norm
  ON referral_institutions ((lower(btrim(name))));

-- Seed: a korábbi hardcoded 3 intézmény + a valós használatban előforduló
-- értékek (patient_referral.beutalo_intezmeny és users.intezmeny).
INSERT INTO referral_institutions (name)
SELECT DISTINCT ON (lower(btrim(name))) btrim(name)
FROM (
  SELECT unnest(ARRAY[
    'OOI Fej-Nyaki Daganatok Multidiszciplináris Központ',
    'Észak-Pesti Centrumkórház',
    'Arc-, Állcsont-, Szájsebészeti és Fogászati Klinika'
  ]) AS name
  UNION ALL
  SELECT beutalo_intezmeny FROM patient_referral WHERE beutalo_intezmeny IS NOT NULL
  UNION ALL
  SELECT intezmeny FROM users WHERE intezmeny IS NOT NULL
) src
WHERE btrim(name) <> ''
ON CONFLICT ((lower(btrim(name)))) DO NOTHING;

COMMIT;
