/**
 * Szabad szöveges klinikai mezők → tipizált (numerikus) SZÁRMAZTATOTT oszlopok.
 *
 * A statisztikai feldolgozhatósághoz a kulcs-numerikus értékeket gépi formában
 * is tároljuk a szabad szöveg MELLETT (az eredetit nem bántjuk). A származtatott
 * oszlopokat mentéskor (és a 051 migráció visszatöltésekor) frissítjük.
 *
 * Best-effort: a szövegből az ELSŐ szám (tizedesvessző/pont engedett). Ha a
 * szöveg tartomány (pl. „60–66 Gy"), az első értéket vesszük; az eredeti szöveg
 * megmarad, így nincs információvesztés.
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from './db';

export interface DbQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** Az első szám kinyerése egy szabad szövegből (tizedesvessző→pont). */
export function extractFirstNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const value = Number.parseFloat(m[0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * A beteg anamnézisének szabad szöveges numerikus mezőiből frissíti a
 * származtatott oszlopokat. Idempotens.
 */
export async function recomputeDerivedNumerics(
  patientId: string,
  db?: DbQueryable | Pool | PoolClient,
): Promise<void> {
  const q = (db ?? getDbPool()) as DbQueryable;
  const res = await q.query(
    `SELECT radioterapia_dozis, dohanyzas_szam
       FROM patient_anamnesis WHERE patient_id = $1`,
    [patientId],
  );
  if (res.rows.length === 0) return;

  const dozisGy = extractFirstNumber(res.rows[0].radioterapia_dozis as string | null);
  const dohanyzasErtek = extractFirstNumber(res.rows[0].dohanyzas_szam as string | null);

  await q.query(
    `UPDATE patient_anamnesis
        SET radioterapia_dozis_gy = $2,
            dohanyzas_szam_ertek = $3
      WHERE patient_id = $1`,
    [patientId, dozisGy, dohanyzasErtek],
  );
}

/** Fire-and-forget burkoló a beteg-mentési útvonalakhoz — sosem dob, csak logol. */
export function recomputeDerivedNumericsSilent(patientId: string): void {
  recomputeDerivedNumerics(patientId).catch((err) => {
    console.error(`[derived-numerics] hiba (${patientId}):`, err);
  });
}
