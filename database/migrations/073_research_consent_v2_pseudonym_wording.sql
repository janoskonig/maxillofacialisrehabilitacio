BEGIN;

-- Kutatási hozzájárulás szövege v1 -> v2: az "anonimizált" megfogalmazás
-- javítása "álnevesített (kódolt)"-re. Az export ténylegesen álnevesített
-- (sózott SHA-256 alany-kulcs + durvított közvetett azonosítók), nem anonim,
-- ezért a hozzájárulási szöveg is így fogalmaz.
--
-- Következmények (ellenőrzött, könnyű):
--   * A már megadott hozzájárulások consent_version_id-je a v1-re mutat; a v1
--     szövege és hash-e VÁLTOZATLAN marad (Art. 7 bizonyíthatóság sértetlen).
--   * Újra-konszentálást ez NEM triggerel; csak a jövőbeli grantok látják a v2-t.
--   * A UI a DB-ből (consent_body_hu) szolgálja ki a szöveget → kódváltozás nem kell.
--
-- Minta: 037_research_consent_flow.sql (ugyanez a seed-szerkezet a v1-hez).

INSERT INTO consent_versions (
  protocol_id,
  version_label,
  consent_text_hash,
  effective_from,
  consent_body_hu,
  is_active
)
SELECT
  p.id,
  'v2',
  encode(sha256('research_consent_v2_hu'::bytea), 'hex'),
  CURRENT_DATE,
  $consent$
A beteg hozzájárulását kéri a maxillofaciális rehabilitációs kutatási regiszter keretében történő álnevesített (kódolt) adatfeldolgozáshoz és kutatási célú felhasználáshoz.

A hozzájárulás önkéntes. A beteg tájékoztatást kap arról, hogy:
- személyes adatai kizárólag a szükséges mértékben kerülnek feldolgozásra;
- a kutatási exportok álnevesített (kódolt) formában készülnek, közvetlen azonosító (név, TAJ, cím, e-mail, telefon) nélkül;
- a hozzájárulás bármikor visszavonható; a visszavonás a jövőbeli kutatási exportokból zárja ki az érintettet;
- a korábban lezárt, fagyasztott exportok audit célú megőrzése a vonatkozó szabályozás szerint történhet.

A hozzájárulás rögzítése után az adatok a regiszter minőségbiztosítási folyamatában továbbíthatók.
$consent$,
  false
FROM registry_protocols p
WHERE p.protocol_code = 'MAXREHAB_REGISTRY'
  AND NOT EXISTS (
    SELECT 1 FROM consent_versions cv
    WHERE cv.protocol_id = p.id AND cv.version_label = 'v2'
  );

-- v2 aktiválása, minden más verzió inaktiválása (idempotens).
UPDATE consent_versions cv
SET is_active = false
FROM registry_protocols p
WHERE cv.protocol_id = p.id
  AND p.protocol_code = 'MAXREHAB_REGISTRY'
  AND cv.version_label <> 'v2';

UPDATE consent_versions cv
SET is_active = true
FROM registry_protocols p
WHERE cv.protocol_id = p.id
  AND p.protocol_code = 'MAXREHAB_REGISTRY'
  AND cv.version_label = 'v2';

COMMIT;
