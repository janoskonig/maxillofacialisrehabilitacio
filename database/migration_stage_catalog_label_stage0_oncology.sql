-- Migration: stage_catalog – onkológiai STAGE_0 címke frissítése
-- Futtatás: psql -d <db> -f database/migration_stage_catalog_label_stage0_oncology.sql
-- Ha már fut az episode_stage_milestone migráció, ezzel frissül a megjelenített név.

UPDATE stage_catalog
SET label_hu = 'Beutalás utáni első konzultációra vár'
WHERE code = 'STAGE_0'
  AND reason = 'onkológiai kezelés utáni állapot';
