-- Migration: sebészorvos szerepkör átnevezése beutaló orvosra (belső érték: beutalo_orvos)
-- Run with: npm run migrate  or  npm run migrate:beutalo-orvos
-- Or: node scripts/run-all-migrations.js 009_sebeszorvos_to_beutalo_orvos.sql

-- 1. Constraint eltávolítása (hogy az UPDATE beutalo_orvos-ra tudja állítani)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Meglévő felhasználók szerepköreinek frissítése
UPDATE users SET role = 'beutalo_orvos' WHERE role = 'sebészorvos';

-- 3. Új CHECK constraint (beutalo_orvos a sebészorvos helyett)
ALTER TABLE users ADD CONSTRAINT users_role_check
CHECK (role IN ('admin', 'fogpótlástanász', 'technikus', 'beutalo_orvos'));

-- 4. Oszlop komment frissítése
COMMENT ON COLUMN users.role IS 'Felhasználó szerepköre: admin, fogpótlástanász, technikus, vagy beutalo_orvos (beutaló orvos)';
