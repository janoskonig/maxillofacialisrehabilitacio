-- Migration: Password reset token mezők hozzáadása a users táblához
-- Run with: psql -d <db> -f database/migration_password_reset.sql

BEGIN;

-- Password reset token oszlop hozzáadása
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255);

-- Password reset token lejárati idő oszlop hozzáadása
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP WITH TIME ZONE;

-- Index hozzáadása a password reset token-hez (gyors kereséshez)
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users(password_reset_token) 
WHERE password_reset_token IS NOT NULL;

-- Kommentek
COMMENT ON COLUMN users.password_reset_token IS 'Biztonságos token a jelszó-visszaállításhoz (null, ha nincs aktív reset kérés)';
COMMENT ON COLUMN users.password_reset_expires IS 'Password reset token lejárati ideje (1 óra a generálástól)';

COMMIT;
