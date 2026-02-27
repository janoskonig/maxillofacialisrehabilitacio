-- Migration: care_pathways XOR fix — reason XOR treatment_type_id
-- Run after: migration_reason_treatment_type.sql
-- Fixes: chk_reason_xor_treatment_type — pontosan az egyik legyen megadva (reason VAGY treatment_type_id)
-- XOR sértők: (1) both NULL, (2) both NOT NULL. Mindkettő tiltott.

BEGIN;

-- 1) adat guard: XOR sértők tiltása
DO $$
DECLARE bad_cnt int;
BEGIN
  SELECT COUNT(*) INTO bad_cnt
  FROM care_pathways
  WHERE (reason IS NULL) = (treatment_type_id IS NULL);

  IF bad_cnt > 0 THEN
    RAISE EXCEPTION 'care_pathways XOR violation: % rows have both NULL or both NOT NULL', bad_cnt;
  END IF;
END $$;

-- 2) régi constraint drop — constraintdef alapján (NE conname LIKE, túl széles!)
DO $$
DECLARE r RECORD;
  def text;
BEGIN
  FOR r IN
    SELECT c.oid, c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'care_pathways' AND c.contype = 'c'
  LOOP
    def := pg_get_constraintdef(r.oid);
    IF def LIKE '%reason%' AND def LIKE '%treatment_type%' THEN
      EXECUTE format('ALTER TABLE care_pathways DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END $$;

-- 3) új XOR constraint (táblaspecifikus név)
ALTER TABLE care_pathways
  ADD CONSTRAINT care_pathways_chk_reason_xor_treatment
  CHECK ( (reason IS NOT NULL) <> (treatment_type_id IS NOT NULL) );

COMMIT;
