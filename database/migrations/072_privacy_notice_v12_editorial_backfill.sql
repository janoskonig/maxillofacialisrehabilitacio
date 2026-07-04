BEGIN;

-- Adatvédelmi tájékoztató v1.1 -> v1.2: SZERKESZTŐI pontosítás.
-- A rendszer kényszerítése eddig is 18 év volt (GUARDIAN_REQUIRED_BELOW_AGE);
-- csak a publikált tájékoztató szövege pontosul 16-ról 18-ra. Mivel a
-- jogosultsági logika nem változik, a meglévő v1.1-es tudomásulvételeket
-- átemeljük v1.2-re, hogy NE kapjon minden beteg újra-felszólítást.
--
-- A backfill-sorokat user_agent-tel jelöljük: ha a DPO utóbb ÉRDEMI
-- változásnak minősíti, célzottan törölhetők, és a rendszer automatikusan
-- újra-felszólít mindenkit:
--   DELETE FROM privacy_notice_acknowledgements
--   WHERE policy_version = '1.2' AND user_agent = 'system-backfill/editorial-1.2';
--
-- Minta: 050_legal_hardening.sql (ugyanez a megközelítés a v1.1 bevezetésekor).

INSERT INTO privacy_notice_acknowledgements (patient_id, policy_version, acknowledged_at, ip_address, user_agent)
SELECT DISTINCT ON (pna.patient_id)
       pna.patient_id, '1.2', pna.acknowledged_at, pna.ip_address,
       'system-backfill/editorial-1.2'
FROM privacy_notice_acknowledgements pna
WHERE pna.policy_version = '1.1'
  AND NOT EXISTS (
    SELECT 1 FROM privacy_notice_acknowledgements x
    WHERE x.patient_id = pna.patient_id AND x.policy_version = '1.2'
  )
ORDER BY pna.patient_id, pna.acknowledged_at DESC;

COMMIT;
