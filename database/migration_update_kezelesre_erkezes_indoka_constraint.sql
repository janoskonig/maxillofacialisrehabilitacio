-- Migration: Frissíti a kezelesre_erkezes_indoka mező CHECK constraint-jét
-- Változtatás: Hozzáadja a 'nincs beutaló' értéket az engedélyezett értékekhez
-- Run with: psql -d <db> -f database/migration_update_kezelesre_erkezes_indoka_constraint.sql

-- Eltávolítja a régi constraint-et
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_kezelesre_erkezes_indoka_check;

-- Hozzáadja az új constraint-et a 'nincs beutaló' értékkel
ALTER TABLE patients ADD CONSTRAINT patients_kezelesre_erkezes_indoka_check 
    CHECK (kezelesre_erkezes_indoka IS NULL OR kezelesre_erkezes_indoka IN (
        'traumás sérülés', 
        'veleszületett rendellenesség', 
        'onkológiai kezelés utáni állapot',
        'nincs beutaló'
    ));

