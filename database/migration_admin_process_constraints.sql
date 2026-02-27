-- Migration: Admin process invariants (go/no-go checklist)
-- Run with: psql -d <db> -f database/migration_admin_process_constraints.sql
-- Ensures: treatment_types.code UNIQUE, stage_catalog (reason, order_index) UNIQUE,
--          care_pathways CHECK reason XOR treatment_type_id (already in migration_reason_treatment_type)

BEGIN;

-- treatment_types.code UNIQUE — already exists in migration_reason_treatment_type (CREATE TABLE UNIQUE)
-- care_pathways CHECK — already exists (chk_reason_xor_treatment_type)

-- stage_catalog: (reason, order_index) UNIQUE for deterministic ordering, 409 on conflict
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_catalog_reason_order
  ON stage_catalog (reason, order_index);

COMMENT ON INDEX idx_stage_catalog_reason_order IS 'Determinisztikus rendezés, orderIndex ütközés → API 409';

COMMIT;
