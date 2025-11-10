-- Migration: Update fogpótlás típus constraints to match TypeScript schema
-- This fixes the constraint violation error when saving values like "cementezett rögzítésű implantációs korona/híd"

BEGIN;

-- Drop existing constraints (try multiple possible names)
-- PostgreSQL may auto-generate constraint names, so we try common patterns
DO $$
DECLARE
    constraint_name text;
BEGIN
    -- Find and drop felso_fogpotlas_tipus constraint
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'patients'::regclass
      AND contype = 'c'
      AND conname LIKE '%felso_fogpotlas_tipus%';
    
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE patients DROP CONSTRAINT IF EXISTS %I', constraint_name);
    END IF;
    
    -- Find and drop also_fogpotlas_tipus constraint
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'patients'::regclass
      AND contype = 'c'
      AND conname LIKE '%also_fogpotlas_tipus%';
    
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE patients DROP CONSTRAINT IF EXISTS %I', constraint_name);
    END IF;
END $$;

-- Add new constraints with all allowed values from TypeScript schema
-- Includes both old and new values for backward compatibility
ALTER TABLE patients ADD CONSTRAINT patients_felso_fogpotlas_tipus_check 
  CHECK (felso_fogpotlas_tipus IS NULL OR felso_fogpotlas_tipus IN (
    'zárólemez',
    'részleges akrilátlemezes fogpótlás',
    'teljes akrilátlemezes fogpótlás',  -- old value, kept for backward compatibility
    'teljes lemezes fogpótlás',
    'fedőlemezes fogpótlás',
    'részleges fémlemezes fogpótlás kapocselhorgonyzással',  -- old value, kept for backward compatibility
    'kapocselhorgonyzású részleges fémlemezes fogpótlás',
    'kombinált fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',  -- old value, kept for backward compatibility
    'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
    'rögzített fogpótlás',  -- old value, kept for backward compatibility
    'rögzített fogpótlás fogakon elhorgonyozva',
    'cementezett rögzítésű implantációs korona/híd',
    'csavarozott rögzítésű implantációs korona/híd',
    'sebészi sablon készítése'
  ));

ALTER TABLE patients ADD CONSTRAINT patients_also_fogpotlas_tipus_check 
  CHECK (also_fogpotlas_tipus IS NULL OR also_fogpotlas_tipus IN (
    'zárólemez',
    'részleges akrilátlemezes fogpótlás',
    'teljes akrilátlemezes fogpótlás',  -- old value, kept for backward compatibility
    'teljes lemezes fogpótlás',
    'fedőlemezes fogpótlás',
    'részleges fémlemezes fogpótlás kapocselhorgonyzással',  -- old value, kept for backward compatibility
    'kapocselhorgonyzású részleges fémlemezes fogpótlás',
    'kombinált fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',  -- old value, kept for backward compatibility
    'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
    'rögzített fogpótlás',  -- old value, kept for backward compatibility
    'rögzített fogpótlás fogakon elhorgonyozva',
    'cementezett rögzítésű implantációs korona/híd',
    'csavarozott rögzítésű implantációs korona/híd',
    'sebészi sablon készítése'
  ));

COMMIT;

