/**
 * Katalógus-lefedettség: DB-ben felvehető kódok vs. a kódbázisban leképezett kódok.
 *
 * A repóban egy ilyen ellenőrző már létezik a munkafázis-oldalon
 * (`lib/step-catalog-cache.ts` → `/api/step-catalog/unmapped` → admin sáv), a
 * fog-kezelések oldalán viszont nem: az adminban felvett `tooth_treatment_catalog`
 * kód azonnal választható a fog-panelen, de „Kész"-re állításkor **csendben** nem
 * vált odontogram-állapotot, amíg valaki kódban fel nem veszi a szabályt. (2026-08-15)
 *
 * Megjegyzés a hatókörről: a két ellenőrzés **iránya különbözik** — a munkafázis-oldal
 * a pathway JSON-ban *használt* kódokat veti össze a katalógussal, ez a modul pedig a
 * katalógusban *kínált* kódokat a kódbeli registryvel. Ezért itt csak az valóban közös
 * rész van kiemelve (a részlegesen migrált környezetek miatt kötelező táblalét-guard),
 * nem egy mindkettőt lefedő álközös absztrakció.
 */

import type { Pool, PoolClient } from 'pg';

export interface DbQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** Postgres azonosító (tábla/oszlop) — interpolálás előtt kötelező ellenőrizni. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(value: string, label: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Érvénytelen ${label}: ${value}`);
  }
  return value;
}

/**
 * Létezik-e a tábla a `public` sémában.
 *
 * A katalógus-táblák egy része nem tracked migrációban jön létre (pl. a
 * `tooth_treatment_catalog` a `database/legacy/`-ban), ezért minden olvasójuk
 * guarddal indul — enélkül a részlegesen migrált dev/CI környezetek elszállnának.
 */
export async function tableExists(
  db: DbQueryable | Pool | PoolClient,
  tableName: string
): Promise<boolean> {
  const q = db as DbQueryable;
  const res = await q.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return res.rows.length > 0;
}

export interface CatalogCoverageOptions {
  /** A katalógus-tábla, ami a kódokat kínálja (pl. `tooth_treatment_catalog`). */
  table: string;
  /** A kód-oszlop neve (pl. `code`). */
  codeColumn: string;
  /** Csak az aktív sorokat nézzük (a táblának `is_active` oszlopa kell legyen). */
  activeOnly?: boolean;
  /** Amit a kódbázis ismer. Ami a katalógusban van, de ebben nincs, az hiányzó leképezés. */
  knownCodes: readonly string[];
}

/**
 * A katalógusban létező, de a kódbázisban le nem képezett kódok.
 *
 * Fontos: a `knownCodes` a **teljes registry kulcshalmaza**, beleértve azokat is,
 * amikhez szándékosan nincs hatás (explicit `null` érték). Ha csak a tényleges
 * szabállyal bíró kódokat adnánk át, a szándékos „nincs vetítés" döntések állandó
 * hamis riasztásként jelennének meg.
 *
 * Nemlétező tábla → üres lista (lásd `tableExists`).
 */
export async function findUnmappedCatalogCodes(
  db: DbQueryable | Pool | PoolClient,
  { table, codeColumn, activeOnly = true, knownCodes }: CatalogCoverageOptions
): Promise<string[]> {
  assertIdentifier(table, 'táblanév');
  assertIdentifier(codeColumn, 'oszlopnév');

  if (!(await tableExists(db, table))) return [];

  const q = db as DbQueryable;
  const res = await q.query(
    `SELECT ${codeColumn} AS code
       FROM ${table}
      ${activeOnly ? 'WHERE is_active = true' : ''}
      ORDER BY ${codeColumn}`
  );

  const known = new Set(knownCodes);
  return res.rows
    .map((r) => r.code as string)
    .filter((code) => code != null && !known.has(code));
}
