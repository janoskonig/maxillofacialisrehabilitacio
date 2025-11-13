-- Migration: Frissíti a nem mező CHECK constraint-jét
-- Változtatás: 'egyeb' → 'nem_ismert'

-- Eltávolítja a régi constraint-et
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_nem_check;

-- Hozzáadja az új constraint-et
ALTER TABLE patients ADD CONSTRAINT patients_nem_check 
    CHECK (nem IS NULL OR nem IN ('ferfi', 'no', 'nem_ismert'));

-- Frissíti a meglévő 'egyeb' értékeket 'nem_ismert'-re (ha vannak)
UPDATE patients 
SET nem = 'nem_ismert' 
WHERE nem = 'egyeb';



