-- Performance indexek hozzáadása gyakori lekérdezésekhez
-- Ez a migráció javítja a lekérdezések teljesítményét

-- Index a patients.created_at mezőre (gyakori ORDER BY)
CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at DESC);

-- Index az appointments.time_slot_id mezőre (gyakori JOIN)
CREATE INDEX IF NOT EXISTS idx_appointments_time_slot_id ON appointments(time_slot_id);

-- Index az available_time_slots.start_time mezőre (gyakori ORDER BY és szűrés)
CREATE INDEX IF NOT EXISTS idx_available_time_slots_start_time ON available_time_slots(start_time);

-- Index az available_time_slots.user_id mezőre (gyakori szűrés)
CREATE INDEX IF NOT EXISTS idx_available_time_slots_user_id ON available_time_slots(user_id);

-- Index az available_time_slots.status mezőre (gyakori szűrés)
CREATE INDEX IF NOT EXISTS idx_available_time_slots_status ON available_time_slots(status);

-- Composite index a time slots lekérdezésekhez (user_id + status + start_time)
CREATE INDEX IF NOT EXISTS idx_available_time_slots_user_status_time ON available_time_slots(user_id, status, start_time);

-- Index az appointments.patient_id mezőre (gyakori JOIN)
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id);

-- Index az activity_logs.user_email mezőre (gyakori szűrés)
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_email ON activity_logs(user_email);

-- Index az activity_logs.created_at mezőre (gyakori ORDER BY)
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);

-- Index a users.email mezőre (gyakori keresés)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Index a users.role mezőre (gyakori szűrés)
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Composite index a users lekérdezésekhez (role + active)
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, active) WHERE active = true;

