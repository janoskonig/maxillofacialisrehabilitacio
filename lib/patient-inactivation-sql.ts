/**
 * Beteg-inaktiválás (117) SQL-fragmentjei — függőségmentes modul, így a
 * cron/worker kódból is biztonságosan importálható.
 *
 * Oszlop-toleránsak (`to_jsonb(alias) ->> ...`): a 117-es migráció előtti
 * sémán is lefutnak (ott minden beteg aktív).
 */

/**
 * WHERE-darab: a beteg aktív. `alias` a `patients` tábla aliasa a FROM-ban
 * (pl. `p`). A `patients_full` VIEW-ra NEM használható (nincs benne az oszlop).
 */
export function activePatientSql(alias: string): string {
  return `(to_jsonb(${alias}) ->> 'inaktivalva_at') IS NULL`;
}

/** WHERE-darab: a beteg inaktív. */
export function inactivePatientSql(alias: string): string {
  return `(to_jsonb(${alias}) ->> 'inaktivalva_at') IS NOT NULL`;
}

/** SELECT-darab a lista/karton nézetekhez (camelCase aliasokkal). */
export function inactivationSelectSql(alias: string): string {
  return [
    `(to_jsonb(${alias}) ->> 'inaktivalva_at')::timestamptz AS "inaktivalvaAt"`,
    `(to_jsonb(${alias}) ->> 'inaktivalas_oka') AS "inaktivalasOka"`,
  ].join(', ');
}
