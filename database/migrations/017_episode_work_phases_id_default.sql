-- Default UUID for new episode_work_phases rows (app INSERT without explicit id).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
  ) THEN
    ALTER TABLE episode_work_phases
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END $$;
