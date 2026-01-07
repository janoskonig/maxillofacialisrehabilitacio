-- Communication logs table for tracking all doctor-patient interactions
-- Run with: psql -d <db> -f database/migration_communication_logs.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create ENUM types
DO $$ BEGIN
    CREATE TYPE communication_type_enum AS ENUM ('message', 'phone', 'in_person', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE communication_direction_enum AS ENUM ('doctor_to_patient', 'patient_to_doctor');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS communication_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL ha nem orvos kezdeményezte
    communication_type communication_type_enum NOT NULL,
    direction communication_direction_enum NOT NULL,
    subject TEXT, -- Opcionális tárgy
    content TEXT NOT NULL, -- Az üzenet/email tartalma vagy leírás
    metadata JSONB, -- Opcionális további információk (pl. telefonhívás időtartama, stb.)
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT -- Email cím aki létrehozta (audit trail)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_communication_logs_patient_id ON communication_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_doctor_id ON communication_logs(doctor_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_communication_type ON communication_logs(communication_type);
CREATE INDEX IF NOT EXISTS idx_communication_logs_created_at ON communication_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_communication_logs_direction ON communication_logs(direction);

-- Comments
COMMENT ON TABLE communication_logs IS 'Érintkezési napló minden orvos-beteg kommunikációról';
COMMENT ON COLUMN communication_logs.communication_type IS 'Kommunikáció típusa: message, phone, in_person, other';
COMMENT ON COLUMN communication_logs.direction IS 'Kommunikáció iránya: doctor_to_patient vagy patient_to_doctor';
COMMENT ON COLUMN communication_logs.metadata IS 'JSON objektum további információkhoz (pl. telefonhívás időtartama, helyszín, stb.)';
COMMENT ON COLUMN communication_logs.created_by IS 'Email cím aki létrehozta a bejegyzést (audit trail)';

