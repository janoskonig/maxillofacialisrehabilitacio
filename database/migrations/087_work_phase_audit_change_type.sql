BEGIN;

-- WP-2.1: minden terv-mutáció írjon auditot — change_type oszlop.
--
-- Eddig csak a státusz-váltás és a törlés írt az episode_work_phase_audit
-- táblába, és az old_status/new_status pár ezt le is fedte. A 2. fázis
-- (változásnapló) viszont MINDEN terv-mutációt naplóz — létrehozást,
-- átrendezést, összevonást/felbontást, időzítés-módosítást, sablon
-- alkalmazását/eltávolítását —, amiket a státusz-pár nem ír le. Ezekhez kell
-- a change_type.
--
-- A change_type értékkészlete (a kód a lib/work-phase-audit.ts helperen át ír):
--   'status_change'   — státusz-váltás (skip / kész / újranyitás / ütemezés-könyvelés)
--   'create'          — fázis létrehozása (katalógusból, szabadszövegesen,
--                       fogkezelésből — kézzel vagy a generate fog-szinkronjával)
--   'delete'          — fázis törlése a tervből (new_status = 'deleted')
--   'reorder'         — átrendezés; EGY összefoglaló sor epizódonként
--                       (episode_work_phase_id NULL, reason a mozgatott fázis(ok)
--                       kódjával) — fázisonkénti sor túl zajos lenne
--   'merge'           — összevonás (soronként a másodlagos, beolvasztott fázisokon)
--   'unmerge'         — felbontás (soronként a kiengedett fázisokon)
--   'timing_change'   — időzítés/címke módosítás (duration_minutes /
--                       default_days_offset / custom_label)
--   'template_apply'  — sablon alkalmazása (generate; csak tényleges
--                       beszúráskor, fázisonként)
--   'template_remove' — sablon eltávolítása az epizódról (fázisonként,
--                       force-szal vagy anélkül; new_status = 'deleted')
--
-- Idempotens: IF NOT EXISTS / feltételes UPDATE — párhuzamos teszt-agent is
-- futtathatja ugyanazon a DB-n.

-- 1) change_type oszlop. A DEFAULT 'status_change' a meglévő sorokat is
--    backfilleli (a 087 előtt csak státusz-váltás és törlés írt auditot).
ALTER TABLE episode_work_phase_audit
  ADD COLUMN IF NOT EXISTS change_type VARCHAR(30) NOT NULL DEFAULT 'status_change';

-- 2) Backfill-finomítás: a törlés-sorok (new_status='deleted') 'delete'-et
--    kapnak. A guard a 'status_change'-re szűkít, így az újrafuttatás nem ír
--    felül későbbi, már helyes change_type-ot ('template_remove' sem sérül).
UPDATE episode_work_phase_audit
   SET change_type = 'delete'
 WHERE new_status = 'deleted'
   AND change_type = 'status_change';

-- 3) A nem státusz-jellegű sorokon az old_status/new_status pár értelmetlen:
--    létrehozásnál nincs old_status, az epizód-szintű reorder-sornál egyik
--    sincs. NULL-ozhatóvá tesszük (a DROP NOT NULL már nullable oszlopon
--    no-op, nem hibázik — idempotens).
ALTER TABLE episode_work_phase_audit ALTER COLUMN old_status DROP NOT NULL;
ALTER TABLE episode_work_phase_audit ALTER COLUMN new_status DROP NOT NULL;

COMMENT ON COLUMN episode_work_phase_audit.change_type IS
  'A terv-mutáció fajtája: status_change | create | delete | reorder | merge | unmerge | timing_change | template_apply | template_remove. A reorder epizód-szintű összefoglaló sor (episode_work_phase_id NULL).';
COMMENT ON COLUMN episode_work_phase_audit.old_status IS
  'A fázis státusza a mutáció előtt; NULL a nem státusz-jellegű sorokon (create, reorder).';
COMMENT ON COLUMN episode_work_phase_audit.new_status IS
  'A fázis státusza a mutáció után (törlésnél ''deleted''); NULL az epizód-szintű reorder-soron.';

COMMIT;
