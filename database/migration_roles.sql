-- Migration: Új szerepkörök bevezetése
-- fogpótlástanász: mindent lát és szerkeszthet
-- epitéziskészítő: csak azokat a betegeket látja, akikhez epitézist rendeltek kezelési tervként
-- sebészorvos: beutalhat betegeket, de csak azokat látja, akiket ő utalt be
-- Run with: psql -d <db> -f database/migration_roles.sql

-- Először frissítjük a role mező constraint-jét, hogy az új szerepköröket is támogassa
ALTER TABLE users 
DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users 
ADD CONSTRAINT users_role_check 
CHECK (role IN ('admin', 'editor', 'viewer', 'fogpótlástanász', 'epitéziskészítő', 'sebészorvos'));

-- Kommentek frissítése
COMMENT ON COLUMN users.role IS 'Felhasználó szerepköre: admin, editor, viewer, fogpótlástanász, epitéziskészítő, vagy sebészorvos';

-- Megjegyzés: A régi szerepkörök (admin, editor, viewer) továbbra is támogatottak a visszafelé kompatibilitásért
-- Az új szerepkörök:
-- - fogpótlástanász: mindent lát és szerkeszthet (ekvivalens az admin/editor szerepkörrel)
-- - epitéziskészítő: csak azokat a betegeket látja, akiknek van kezelesi_terv_arcot_erinto
-- - sebészorvos: beutalhat betegeket, de csak azokat látja, akiket ő utalt be (beutalo_orvos mező alapján)

