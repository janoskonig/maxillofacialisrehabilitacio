-- Migration: DROP stage_steps — kezelési terv = care_pathways.steps_json (episode.care_pathway_id)
-- Run with: psql -d <db> -f database/migration_drop_stage_steps.sql
-- stage_steps koncepciója hibás: a care plan determinánsa a pathway, nem generikus stage→step mapping.

BEGIN;

DROP TABLE IF EXISTS stage_steps;

COMMIT;
