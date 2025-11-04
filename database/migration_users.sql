-- Users tábla létrehozása biztonságos hitelesítéshez
-- A jelszavak bcrypt hash-tel lesznek tárolva

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,  -- bcrypt hash (60 karakter)
    role VARCHAR(20) DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

-- Index az email címhez (gyors kereséshez)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Trigger a frissítés dátumának automatikus frissítéséhez
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Kommentek
COMMENT ON TABLE users IS 'Rendszer felhasználók - biztonságos hitelesítéshez';
COMMENT ON COLUMN users.email IS 'Felhasználó email címe (egyedi)';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt hash-elt jelszó (soha ne tároljunk plaintext jelszót!)';
COMMENT ON COLUMN users.role IS 'Felhasználó szerepköre: admin, editor, vagy viewer';

