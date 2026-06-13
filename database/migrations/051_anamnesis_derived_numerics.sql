BEGIN;

-- Tipizált (numerikus) SZÁRMAZTATOTT oszlopok a szabad szöveges anamnézis-mezők
-- mellé — a statisztikai feldolgozhatóságért. Az eredeti szöveges oszlopok
-- változatlanok maradnak (nincs információvesztés); a származtatott oszlopokat
-- mentéskor (lib/derived-numerics.ts) és itt, visszatöltéskor frissítjük.
--
--   radioterapia_dozis (VARCHAR)  → radioterapia_dozis_gy (NUMERIC, ~Gy)
--   dohanyzas_szam     (VARCHAR)  → dohanyzas_szam_ertek  (NUMERIC)

ALTER TABLE patient_anamnesis
  ADD COLUMN IF NOT EXISTS radioterapia_dozis_gy NUMERIC,
  ADD COLUMN IF NOT EXISTS dohanyzas_szam_ertek NUMERIC;

-- Visszatöltés: az első szám a szövegből (tizedesvessző→pont). A nem szám
-- tartalmú mezők NULL-ban maradnak. A ::numeric cast hibák ellen a regex csak
-- jól formált számot enged át.
UPDATE patient_anamnesis
   SET radioterapia_dozis_gy =
         NULLIF(replace(substring(radioterapia_dozis from '[0-9]+(?:[.,][0-9]+)?'), ',', '.'), '')::numeric
 WHERE radioterapia_dozis IS NOT NULL
   AND radioterapia_dozis_gy IS NULL
   AND substring(radioterapia_dozis from '[0-9]+(?:[.,][0-9]+)?') IS NOT NULL;

UPDATE patient_anamnesis
   SET dohanyzas_szam_ertek =
         NULLIF(replace(substring(dohanyzas_szam from '[0-9]+(?:[.,][0-9]+)?'), ',', '.'), '')::numeric
 WHERE dohanyzas_szam IS NOT NULL
   AND dohanyzas_szam_ertek IS NULL
   AND substring(dohanyzas_szam from '[0-9]+(?:[.,][0-9]+)?') IS NOT NULL;

COMMIT;
