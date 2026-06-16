-- 058_widen_step_code_to_80.sql
--
-- Fix: a work-phase code can be up to 80 chars (episode_work_phases.work_phase_code,
-- episode_steps.step_code are VARCHAR(80)), but slot_intents.step_code,
-- appointments.step_code and episode_next_step_cache.step_code were VARCHAR(50).
-- A seeded care pathway ("Kapocselhorgonyzású részleges fémlemezes fogpótlás") has a
-- 54-char code, so projectRemainingSteps / appointment booking threw
-- `value too long for type character varying(50)` and the whole episode could not be
-- projected or booked. Widen all step-code columns to 80 to match the canonical width.

ALTER TABLE slot_intents          ALTER COLUMN step_code TYPE VARCHAR(80);
ALTER TABLE appointments          ALTER COLUMN step_code TYPE VARCHAR(80);
ALTER TABLE episode_next_step_cache ALTER COLUMN step_code TYPE VARCHAR(80);
