BEGIN;

-- Meglévő adatok rendezése: elhunyt betegnek ne maradjon nyitott ellátása,
-- recall-feladata vagy nyitott kapacitás/ütemezési szándéka.
UPDATE patient_episodes pe
   SET status = 'closed',
       closed_at = COALESCE(pe.closed_at, CURRENT_TIMESTAMP)
  FROM patients p
 WHERE p.id = pe.patient_id
   AND p.halal_datum IS NOT NULL
   AND pe.status = 'open';

UPDATE episode_tasks et
   SET completed_at = COALESCE(et.completed_at, CURRENT_TIMESTAMP)
  FROM patient_episodes pe
  JOIN patients p ON p.id = pe.patient_id
 WHERE et.episode_id = pe.id
   AND p.halal_datum IS NOT NULL
   AND et.completed_at IS NULL;

UPDATE slot_intents si
   SET state = 'expired',
       updated_at = CURRENT_TIMESTAMP
  FROM patient_episodes pe
  JOIN patients p ON p.id = pe.patient_id
 WHERE si.episode_id = pe.id
   AND p.halal_datum IS NOT NULL
   AND si.state = 'open';

-- Közvetlen SQL-ből és minden jövőbeli alkalmazási útvonalból is tilos legyen
-- elhunyt beteghez nyitott epizódot beszúrni vagy egy régit visszanyitni.
CREATE OR REPLACE FUNCTION prevent_open_episode_for_deceased_patient()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  patient_death_date DATE;
BEGIN
  IF NEW.status = 'open' THEN
    -- A beteg sorának zárolása megszünteti a halálozás-rögzítés és az
    -- epizódnyitás közötti versenyhelyzetet.
    SELECT p.halal_datum
      INTO patient_death_date
      FROM patients p
     WHERE p.id = NEW.patient_id
     FOR UPDATE;

    IF patient_death_date IS NOT NULL THEN
      RAISE EXCEPTION 'Elhunyt beteghez nem nyitható ellátási epizód.'
        USING ERRCODE = '23514',
              CONSTRAINT = 'patient_episodes_deceased_patient_guard';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patient_episodes_deceased_guard ON patient_episodes;
CREATE TRIGGER trg_patient_episodes_deceased_guard
BEFORE INSERT OR UPDATE OF patient_id, status
ON patient_episodes
FOR EACH ROW
EXECUTE FUNCTION prevent_open_episode_for_deceased_patient();

-- Lezárt/elhunyt ellátáshoz ne lehessen új aktív recall- vagy más
-- epizódfeladatot, illetve nyitott ütemezési szándékot létrehozni.
CREATE OR REPLACE FUNCTION prevent_pending_task_for_inactive_episode()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  episode_status TEXT;
  patient_death_date DATE;
BEGIN
  IF NEW.completed_at IS NULL THEN
    SELECT pe.status, p.halal_datum
      INTO episode_status, patient_death_date
      FROM patient_episodes pe
      JOIN patients p ON p.id = pe.patient_id
     WHERE pe.id = NEW.episode_id
     FOR UPDATE OF p;

    IF episode_status IS DISTINCT FROM 'open' OR patient_death_date IS NOT NULL THEN
      RAISE EXCEPTION 'Lezárt vagy elhunyt beteg epizódjához nem hozható létre aktív feladat.'
        USING ERRCODE = '23514',
              CONSTRAINT = 'episode_tasks_active_episode_guard';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_episode_tasks_active_episode_guard ON episode_tasks;
CREATE TRIGGER trg_episode_tasks_active_episode_guard
BEFORE INSERT OR UPDATE OF episode_id, completed_at
ON episode_tasks
FOR EACH ROW
EXECUTE FUNCTION prevent_pending_task_for_inactive_episode();

CREATE OR REPLACE FUNCTION prevent_open_intent_for_inactive_episode()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  episode_status TEXT;
  patient_death_date DATE;
BEGIN
  IF NEW.state = 'open' THEN
    SELECT pe.status, p.halal_datum
      INTO episode_status, patient_death_date
      FROM patient_episodes pe
      JOIN patients p ON p.id = pe.patient_id
     WHERE pe.id = NEW.episode_id
     FOR UPDATE OF p;

    IF episode_status IS DISTINCT FROM 'open' OR patient_death_date IS NOT NULL THEN
      RAISE EXCEPTION 'Lezárt vagy elhunyt beteg epizódjához nem hozható létre nyitott ütemezési szándék.'
        USING ERRCODE = '23514',
              CONSTRAINT = 'slot_intents_active_episode_guard';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slot_intents_active_episode_guard ON slot_intents;
CREATE TRIGGER trg_slot_intents_active_episode_guard
BEFORE INSERT OR UPDATE OF episode_id, state
ON slot_intents
FOR EACH ROW
EXECUTE FUNCTION prevent_open_intent_for_inactive_episode();

-- A halálozási dátum rögzítése önmagában, ugyanabban a tranzakcióban zárja le
-- az epizódot és a recall/ütemezési állapotot akkor is, ha nem az API írta.
CREATE OR REPLACE FUNCTION close_patient_care_after_death_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  should_close BOOLEAN := FALSE;
BEGIN
  IF NEW.halal_datum IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      should_close := TRUE;
    ELSIF OLD.halal_datum IS DISTINCT FROM NEW.halal_datum THEN
      should_close := TRUE;
    END IF;
  END IF;

  IF should_close THEN
    UPDATE patient_episodes
       SET status = 'closed',
           closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)
     WHERE patient_id = NEW.id
       AND status = 'open';

    UPDATE episode_tasks et
       SET completed_at = COALESCE(et.completed_at, CURRENT_TIMESTAMP)
      FROM patient_episodes pe
     WHERE et.episode_id = pe.id
       AND pe.patient_id = NEW.id
       AND et.completed_at IS NULL;

    UPDATE slot_intents si
       SET state = 'expired',
           updated_at = CURRENT_TIMESTAMP
      FROM patient_episodes pe
     WHERE si.episode_id = pe.id
       AND pe.patient_id = NEW.id
       AND si.state = 'open';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patients_close_care_on_death ON patients;
CREATE TRIGGER trg_patients_close_care_on_death
AFTER INSERT OR UPDATE OF halal_datum
ON patients
FOR EACH ROW
EXECUTE FUNCTION close_patient_care_after_death_date();

COMMIT;
