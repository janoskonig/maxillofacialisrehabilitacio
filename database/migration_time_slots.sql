-- Migration: Time slots and appointments system
-- Run with: psql -d <db> -f database/migration_time_slots.sql

BEGIN;

-- Available time slots table
CREATE TABLE IF NOT EXISTS available_time_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'booked')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Appointments table
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    time_slot_id UUID NOT NULL REFERENCES available_time_slots(id) ON DELETE CASCADE,
    created_by VARCHAR(255) NOT NULL, -- Email of the surgeon who booked
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(time_slot_id) -- One appointment per time slot
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_available_time_slots_user_id ON available_time_slots(user_id);
CREATE INDEX IF NOT EXISTS idx_available_time_slots_start_time ON available_time_slots(start_time);
CREATE INDEX IF NOT EXISTS idx_available_time_slots_status ON available_time_slots(status);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_time_slot_id ON appointments(time_slot_id);
CREATE INDEX IF NOT EXISTS idx_appointments_created_by ON appointments(created_by);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_time_slots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_available_time_slots_updated_at
    BEFORE UPDATE ON available_time_slots
    FOR EACH ROW
    EXECUTE FUNCTION update_time_slots_updated_at();

-- Comments
COMMENT ON TABLE available_time_slots IS 'Szabad időpontok, amelyeket a fogpótlástanászok hozhatnak létre';
COMMENT ON COLUMN available_time_slots.user_id IS 'A fogpótlástanász felhasználó ID-ja, aki az időpontot létrehozta';
COMMENT ON COLUMN available_time_slots.start_time IS 'Az időpont kezdete (csak jövőbeli dátumok)';
COMMENT ON COLUMN available_time_slots.status IS 'Az időpont státusza: available vagy booked';

COMMENT ON TABLE appointments IS 'Időpont foglalások, amelyeket a sebészorvosok hozhatnak létre';
COMMENT ON COLUMN appointments.patient_id IS 'A beteg ID-ja';
COMMENT ON COLUMN appointments.time_slot_id IS 'A lefoglalt időpont ID-ja';
COMMENT ON COLUMN appointments.created_by IS 'A sebészorvos email címe, aki lefoglalta az időpontot';

COMMIT;

