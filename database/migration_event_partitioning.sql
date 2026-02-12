-- Migration: Event log partitioning + retention policy
-- Run with: psql -d <db> -f database/migration_event_partitioning.sql
-- Implements: Partition appointment_status_events, slot_state_events, provider_assignment_events by month.
-- Retention: 3 years (partitions dropped by event-retention cron).

BEGIN;

-- =============================================================================
-- 1. appointment_status_events: convert to partitioned table (range by month)
-- =============================================================================

-- Create partitioned parent (same structure as original)
CREATE TABLE IF NOT EXISTS appointment_status_events_new (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    old_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions: from 2020-01 to current + 2 years ahead (monthly)
-- Function to create partition if not exists
CREATE OR REPLACE FUNCTION create_month_partition(
    parent_table TEXT,
    partition_month DATE
) RETURNS void AS $$
DECLARE
    part_name TEXT;
    start_ts TIMESTAMPTZ;
    end_ts TIMESTAMPTZ;
BEGIN
    part_name := parent_table || '_' || to_char(partition_month, 'YYYY_MM');
    start_ts := date_trunc('month', partition_month);
    end_ts := start_ts + INTERVAL '1 month';

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        part_name, parent_table, start_ts, end_ts
    );
END;
$$ LANGUAGE plpgsql;

-- Create partitions for appointment_status_events_new (2020-01 through 2028-12)
DO $$
DECLARE
    d DATE := '2020-01-01';
BEGIN
    WHILE d <= '2028-12-01' LOOP
        PERFORM create_month_partition('appointment_status_events_new', d);
        d := d + INTERVAL '1 month';
    END LOOP;
END;
$$;

-- Migrate existing data (if table exists and has data)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'appointment_status_events' AND table_schema = 'public') THEN
        INSERT INTO appointment_status_events_new (id, appointment_id, old_status, new_status, created_at, created_by)
        SELECT id, appointment_id, old_status, new_status, COALESCE(created_at, CURRENT_TIMESTAMP), created_by
        FROM appointment_status_events;
        DROP TABLE appointment_status_events;
    END IF;
EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN undefined_column THEN NULL;  -- old table may have different structure
END;
$$;

ALTER TABLE appointment_status_events_new RENAME TO appointment_status_events;

CREATE INDEX IF NOT EXISTS idx_appointment_status_events_appointment ON appointment_status_events(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_status_events_created ON appointment_status_events(created_at);

-- =============================================================================
-- 2. slot_state_events (new partitioned table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS slot_state_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES available_time_slots(id) ON DELETE CASCADE,
    old_state VARCHAR(16),
    new_state VARCHAR(16) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
    d DATE := '2020-01-01';
BEGIN
    WHILE d <= '2028-12-01' LOOP
        PERFORM create_month_partition('slot_state_events', d);
        d := d + INTERVAL '1 month';
    END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_slot_state_events_slot ON slot_state_events(slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_state_events_created ON slot_state_events(created_at);

COMMENT ON TABLE slot_state_events IS 'Immutable audit: slot state changes (free/offered/held/booked/blocked). Partitioned by month; retention 3 years.';

-- =============================================================================
-- 3. provider_assignment_events (new partitioned table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS provider_assignment_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    old_user_id UUID REFERENCES users(id),
    new_user_id UUID NOT NULL REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
    d DATE := '2020-01-01';
BEGIN
    WHILE d <= '2028-12-01' LOOP
        PERFORM create_month_partition('provider_assignment_events', d);
        d := d + INTERVAL '1 month';
    END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_provider_assignment_events_episode ON provider_assignment_events(episode_id);
CREATE INDEX IF NOT EXISTS idx_provider_assignment_events_created ON provider_assignment_events(created_at);

COMMENT ON TABLE provider_assignment_events IS 'Immutable audit: provider/care team changes. Partitioned by month; retention 3 years.';

-- =============================================================================
-- 4. Retention: function to drop partitions older than retention_days
-- Partition names end with _YYYY_MM (e.g. appointment_status_events_new_2020_01)
-- =============================================================================

CREATE OR REPLACE FUNCTION drop_old_event_partitions(retention_days INT DEFAULT 1095)
RETURNS TABLE(dropped_table TEXT, partition_month DATE) AS $$
DECLARE
    r RECORD;
    cutoff DATE := (CURRENT_DATE - (retention_days || ' days')::interval);
    part_month DATE;
    m TEXT[];
BEGIN
    FOR r IN (
        SELECT child.relname AS partition_name
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        WHERE parent.relname IN ('appointment_status_events', 'slot_state_events', 'provider_assignment_events')
    ) LOOP
        -- Extract YYYY_MM from partition name (e.g. ..._2020_01)
        m := regexp_match(r.partition_name, '_(\d{4})_(\d{2})$');
        IF m IS NOT NULL AND array_length(m, 1) >= 3 THEN
            part_month := (m[1] || '-' || m[2] || '-01')::date;
            -- Partition holds data for part_month; upper bound is part_month + 1.
            -- Drop if part_month + 1 month < cutoff (i.e. partition completely before cutoff)
            IF (part_month + INTERVAL '1 month')::DATE <= cutoff THEN
                BEGIN
                    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', r.partition_name);
                    dropped_table := r.partition_name;
                    partition_month := part_month;
                    RETURN NEXT;
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Could not drop partition %: %', r.partition_name, SQLERRM;
                END;
            END IF;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION drop_old_event_partitions IS 'Drops event log partitions older than retention_days (default 1095 = 3 years). Run from cron weekly.';

DROP FUNCTION IF EXISTS create_month_partition(TEXT, DATE);

COMMIT;
