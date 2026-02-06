-- Migration: Episode + Stage catalog + Stage events + Patient milestones (homogén betegcsoport, kétrétegű modell)
-- Run with: psql -d <db> -f database/migration_episode_stage_milestone.sql
-- Depends: patients table, generate_uuid()

BEGIN;

-- =============================================================================
-- 1. patient_episodes (ellátási epizódok / cases)
-- =============================================================================
CREATE TABLE IF NOT EXISTS patient_episodes (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    reason VARCHAR(100) NOT NULL CHECK (reason IN ('traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot')),
    pathway_code VARCHAR(50),
    chief_complaint VARCHAR(500) NOT NULL,
    case_title VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'paused')),
    opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE,
    parent_episode_id UUID REFERENCES patient_episodes(id),
    trigger_type VARCHAR(50) CHECK (trigger_type IN ('recidiva', 'fogelvesztes', 'potlasvesztes', 'kontrollbol_uj_panasz', 'egyeb')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_patient_episodes_patient_id ON patient_episodes(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_episodes_status ON patient_episodes(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_patient_episodes_opened_at ON patient_episodes(patient_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_episodes_reason ON patient_episodes(reason);

COMMENT ON TABLE patient_episodes IS 'Ellátási epizódok – egy betegnek több epizódja lehet (recidíva, új probléma).';

-- =============================================================================
-- 2. stage_catalog (7-8 univerzális stádium, etiológia-specifikus label)
-- PK (code, reason) mert ugyanaz a code más label_hu-val más reason-nál
-- =============================================================================
CREATE TABLE IF NOT EXISTS stage_catalog (
    code VARCHAR(50) NOT NULL,
    reason VARCHAR(100) NOT NULL CHECK (reason IN ('traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot')),
    label_hu VARCHAR(255) NOT NULL,
    order_index INT NOT NULL,
    is_terminal BOOLEAN NOT NULL DEFAULT false,
    default_duration_days INT,
    PRIMARY KEY (code, reason)
);

INSERT INTO stage_catalog (code, reason, label_hu, order_index, is_terminal, default_duration_days) VALUES
('STAGE_0', 'onkológiai kezelés utáni állapot', 'Intake / első konzultációra vár', 0, false, null),
('STAGE_1', 'onkológiai kezelés utáni állapot', 'Diagnosztika & dokumentáció folyamatban', 1, false, null),
('STAGE_2', 'onkológiai kezelés utáni állapot', 'Terv & árajánlat készül / egyeztetés', 2, false, null),
('STAGE_3', 'onkológiai kezelés utáni állapot', 'Elfogadva / finanszírozás-rendelés előkészítés', 3, false, null),
('STAGE_4', 'onkológiai kezelés utáni állapot', 'Sebészi fázis folyamatban (ha van)', 4, false, null),
('STAGE_5', 'onkológiai kezelés utáni állapot', 'Protetikai fázis folyamatban', 5, false, null),
('STAGE_6', 'onkológiai kezelés utáni állapot', 'Átadás megtörtént', 6, false, null),
('STAGE_7', 'onkológiai kezelés utáni állapot', 'Gondozás / kontroll', 7, true, null),
('STAGE_0', 'traumás sérülés', 'Akut utáni beutalás / első konzultációra vár', 0, false, null),
('STAGE_1', 'traumás sérülés', 'Státuszfelvétel + dokumentáció', 1, false, null),
('STAGE_2', 'traumás sérülés', 'Rekonstrukciós terv & árajánlat', 2, false, null),
('STAGE_3', 'traumás sérülés', 'Elfogadva / időzítés & előkészítés', 3, false, null),
('STAGE_4', 'traumás sérülés', 'Sebészi fázis (ha van)', 4, false, null),
('STAGE_5', 'traumás sérülés', 'Protetikai fázis', 5, false, null),
('STAGE_6', 'traumás sérülés', 'Átadás', 6, false, null),
('STAGE_7', 'traumás sérülés', 'Gondozás', 7, true, null),
('STAGE_0', 'veleszületett rendellenesség', 'Első konzultációra vár', 0, false, null),
('STAGE_1', 'veleszületett rendellenesség', 'Státuszfelvétel + dokumentáció', 1, false, null),
('STAGE_2', 'veleszületett rendellenesség', 'Hosszú távú terv + etapok', 2, false, null),
('STAGE_3', 'veleszületett rendellenesség', 'Elfogadva / etap indítás', 3, false, null),
('STAGE_4', 'veleszületett rendellenesség', 'Sebészi/ortho fázis (ha releváns)', 4, false, null),
('STAGE_5', 'veleszületett rendellenesség', 'Protetikai fázis', 5, false, null),
('STAGE_6', 'veleszületett rendellenesség', 'Átadás', 6, false, null),
('STAGE_7', 'veleszületett rendellenesség', 'Gondozás', 7, true, null)
ON CONFLICT (code, reason) DO NOTHING;

-- =============================================================================
-- 3. stage_events (stádium események, epizódhoz kötve)
-- Validáció: API ellenőrzi, hogy stage_code + epizód reason szerepel a stage_catalog-ban
-- =============================================================================
CREATE TABLE IF NOT EXISTS stage_events (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    stage_code VARCHAR(50) NOT NULL,
    at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stage_events_patient_episode_at ON stage_events(patient_id, episode_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_events_episode_at ON stage_events(episode_id, at DESC);

-- =============================================================================
-- 4. patient_milestones (granuláris események, epizódhoz kötve)
-- =============================================================================
CREATE TABLE IF NOT EXISTS patient_milestones (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    code VARCHAR(80) NOT NULL,
    at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    params JSONB,
    note TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_milestones_patient_episode_at ON patient_milestones(patient_id, episode_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_milestones_episode_code ON patient_milestones(episode_id, code);

-- =============================================================================
-- 5. milestone_auto_generation (virtuális milestone pl. SURG_IMPLANT_PLACED -> SURG_OSSEOINTEGRATED)
-- =============================================================================
CREATE TABLE IF NOT EXISTS milestone_auto_generation (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    trigger_milestone_code VARCHAR(80) NOT NULL,
    generated_milestone_code VARCHAR(80) NOT NULL,
    after_days INT NOT NULL,
    mode VARCHAR(20) NOT NULL DEFAULT 'virtual' CHECK (mode IN ('virtual', 'persisted')),
    enabled BOOLEAN NOT NULL DEFAULT true
);

-- Egyedi sor: trigger + generated páros (futtatás második alkalommal skip)
INSERT INTO milestone_auto_generation (trigger_milestone_code, generated_milestone_code, after_days, mode, enabled)
SELECT 'SURG_IMPLANT_PLACED', 'SURG_OSSEOINTEGRATED', 183, 'virtual', true
WHERE NOT EXISTS (SELECT 1 FROM milestone_auto_generation WHERE trigger_milestone_code = 'SURG_IMPLANT_PLACED' AND generated_milestone_code = 'SURG_OSSEOINTEGRATED');
-- =============================================================================
-- 6. Backfill: patient_stages -> patient_episodes + stage_events (ha létezik patient_stages)
-- =============================================================================
DO $$
DECLARE
    r RECORD;
    ep_id UUID;
    pat_reason VARCHAR(100);
    first_date TIMESTAMP WITH TIME ZONE;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_stages') THEN
        FOR r IN SELECT DISTINCT patient_id FROM patient_stages
        LOOP
            SELECT kezelesre_erkezes_indoka INTO pat_reason FROM patients WHERE id = r.patient_id;
            IF pat_reason IS NULL OR pat_reason = '' THEN
                pat_reason := 'onkológiai kezelés utáni állapot';
            END IF;
            SELECT MIN(stage_date) INTO first_date FROM patient_stages WHERE patient_id = r.patient_id;
            INSERT INTO patient_episodes (patient_id, reason, chief_complaint, status, opened_at, created_by)
            VALUES (r.patient_id, pat_reason, 'Első ellátás (migráció)', 'open', COALESCE(first_date, CURRENT_TIMESTAMP), 'system')
            RETURNING id INTO ep_id;
            INSERT INTO stage_events (patient_id, episode_id, stage_code, at, note, created_by)
            SELECT
                ps.patient_id,
                ep_id,
                CASE ps.stage
                    WHEN 'uj_beteg' THEN 'STAGE_0'
                    WHEN 'onkologiai_kezeles_kesz' THEN 'STAGE_0'
                    WHEN 'arajanlatra_var' THEN 'STAGE_2'
                    WHEN 'implantacios_sebeszi_tervezesre_var' THEN 'STAGE_2'
                    WHEN 'fogpotlasra_var' THEN 'STAGE_5'
                    WHEN 'fogpotlas_keszul' THEN 'STAGE_5'
                    WHEN 'fogpotlas_kesz' THEN 'STAGE_6'
                    WHEN 'gondozas_alatt' THEN 'STAGE_7'
                    ELSE 'STAGE_0'
                END,
                ps.stage_date,
                ps.notes,
                ps.created_by
            FROM patient_stages ps
            WHERE ps.patient_id = r.patient_id
            ORDER BY ps.stage_date ASC;
        END LOOP;
    END IF;
END $$;

COMMIT;
