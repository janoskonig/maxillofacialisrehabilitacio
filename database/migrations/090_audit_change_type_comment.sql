-- 090: a change_type oszlop-komment bővítése (visit_change, scope_change — WP-4.2)
--
-- A 087-es migráció már alkalmazott környezetekben él (node_migrations), ezért
-- a fájl utólagos szerkesztése ott soha nem futna le — a DB-beli komment
-- frissítése külön migráció. Idempotens: a COMMENT felülír.
COMMENT ON COLUMN episode_work_phase_audit.change_type IS
  'A terv-mutáció fajtája: status_change | create | delete | reorder | merge | unmerge | timing_change | template_apply | template_remove | integrity_repair | visit_change | scope_change. A reorder és a vizit-műveletek összefoglaló sora epizód-szintű (episode_work_phase_id NULL).';
