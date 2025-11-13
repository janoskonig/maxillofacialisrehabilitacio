-- Migráció: BNO és Diagnózis mezők hozzáadása az onkológiai kezelés utáni állapot részhez
-- Run with: psql -d <db> -f database/migration_add_bno_diagnozis.sql

-- BNO mező hozzáadása
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS bno TEXT;

-- Diagnózis mező hozzáadása
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS diagnozis TEXT;

-- Kommentek
COMMENT ON COLUMN patients.bno IS 'BNO (onkológiai kezelés utáni állapot)';
COMMENT ON COLUMN patients.diagnozis IS 'Diagnózis (onkológiai kezelés utáni állapot)';


