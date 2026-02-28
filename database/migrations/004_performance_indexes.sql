-- Performance indexes for hot query patterns
-- Safe to run multiple times (IF NOT EXISTS)

-- stage_events: every worklist/episode query does DISTINCT ON (episode_id) ORDER BY at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stage_events_episode_at_desc
  ON stage_events (episode_id, at DESC);

-- appointments by episode + status (forecasts, worklists, enrichment)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_episode_status
  ON appointments (episode_id, appointment_status);

-- appointments by episode + start_time (future appointment lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_episode_start_time
  ON appointments (episode_id, start_time)
  WHERE start_time IS NOT NULL;

-- appointments by patient + no_show (worklist no-show counts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_patient_no_show
  ON appointments (patient_id)
  WHERE appointment_status = 'no_show';

-- episode_steps ordering (worklist batch prefetch)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_episode_steps_episode_seq
  ON episode_steps (episode_id, seq, pathway_order_index);

-- episode_pathways by episode + ordinal
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_episode_pathways_episode_ordinal
  ON episode_pathways (episode_id, ordinal);

-- episode_blocks active lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_episode_blocks_active
  ON episode_blocks (episode_id, expires_at)
  WHERE active = true;

-- patient_episodes open status (worklist, WIP queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_episodes_open
  ON patient_episodes (status, opened_at)
  WHERE status = 'open';

-- patient_documents by patient (list-enrichment queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_documents_patient_id
  ON patient_documents (patient_id);

-- patient_documents tags GIN (tag-based filtering in list-enrichment)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_documents_tags_gin
  ON patient_documents USING GIN (tags);

-- episode_forecast_cache lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_episode_forecast_cache_episode
  ON episode_forecast_cache (episode_id, status);

-- episode_next_step_cache provider lookup (worklist, recommendations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_episode_next_step_cache_provider
  ON episode_next_step_cache (provider_id, status)
  WHERE status = 'ready';

-- episode_care_team primary member lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_episode_care_team_primary
  ON episode_care_team (episode_id, user_id)
  WHERE is_primary = true;
