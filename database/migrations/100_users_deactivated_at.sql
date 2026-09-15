-- 100: Felhasználó-inaktiválás nyoma a users táblán.
--
-- Eddig a `users.active = false` két, egymástól különböző állapotot takart:
--   • jóváhagyásra váró regisztráció (még sosem volt aktív), és
--   • admin által inaktivált (korábban aktív) fiók.
-- Az admin felület mindkettőt a „Jóváhagyásra váró" listában mutatta, a DELETE
-- pedig egy inaktivált (FK-kkal körbeszőtt) fiókot is fizikailag törölt volna.
--
-- A `deactivated_at` teszi egyértelművé:
--   active = true                              → aktív fiók
--   active = false AND deactivated_at IS NULL  → jóváhagyásra váró regisztráció
--   active = false AND deactivated_at NOT NULL → inaktivált fiók (újraaktiválható)
--
-- Backfill-heurisztika: aki inaktív, de valaha bejelentkezett (`last_login`),
-- az csak jóváhagyott fiókként tehette — vagyis inaktiválták. Ezek a sorok
-- „inaktivált"-ként kerülnek át, hogy ne szennyezzék tovább a jóváhagyási listát.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by VARCHAR(255);

COMMENT ON COLUMN users.deactivated_at IS
  'Admin általi inaktiválás időpontja (NULL = sosem inaktivált). active=false + NULL = jóváhagyásra váró regisztráció.';
COMMENT ON COLUMN users.deactivated_by IS
  'Az inaktiváló admin e-mail címe (vagy migration_100 a visszamenőleges besorolásnál).';

UPDATE users
   SET deactivated_at = COALESCE(updated_at, CURRENT_TIMESTAMP),
       deactivated_by = 'migration_100'
 WHERE active = false
   AND deactivated_at IS NULL
   AND last_login IS NOT NULL;

COMMIT;
