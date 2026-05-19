-- Normalize protocol codes and consent text (remove obsolete external abbreviation).

UPDATE registry_protocols
SET
  protocol_code = 'MAXREHAB_REGISTRY',
  title = 'Maxillofaciális rehabilitációs kutatási regiszter'
WHERE protocol_code = 'TMK_MAXREHAB';

UPDATE consent_versions cv
SET consent_body_hu = regexp_replace(
      consent_body_hu,
      '\(TMK\)\s*',
      '',
      'gi'
    )
FROM registry_protocols p
WHERE cv.protocol_id = p.id
  AND p.protocol_code = 'MAXREHAB_REGISTRY'
  AND cv.consent_body_hu IS NOT NULL;

UPDATE consent_versions cv
SET consent_body_hu = replace(
      consent_body_hu,
      'Maxillofaciális Rehabilitációs Regiszter',
      'maxillofaciális rehabilitációs kutatási regiszter'
    )
FROM registry_protocols p
WHERE cv.protocol_id = p.id
  AND p.protocol_code = 'MAXREHAB_REGISTRY';

UPDATE consent_versions cv
SET consent_text_hash = encode(sha256(convert_to(cv.consent_body_hu, 'UTF8')), 'hex')
FROM registry_protocols p
WHERE cv.protocol_id = p.id
  AND p.protocol_code = 'MAXREHAB_REGISTRY'
  AND cv.consent_body_hu IS NOT NULL;
