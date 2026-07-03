import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import {
  normalizeTaj,
  isSearchableTaj,
  namesSimilar,
  maskedPatientLabel,
  type DuplicateMatch,
} from '@/lib/patient-duplicate-check';

export const dynamic = 'force-dynamic';

/** Azonos születési dátumú jelöltek felső korlátja (a név-szűrés memóriában fut). */
const DOB_CANDIDATE_LIMIT = 200;

/**
 * GET /api/patients/duplicate-check?taj=...&nev=...&szuletesiDatum=YYYY-MM-DD
 *
 * Proaktív duplikátum-keresés a gyors betegfelvételhez:
 *  - pontos (normalizált) TAJ egyezés → 'taj' találat;
 *  - azonos születési dátum + hasonló név → 'nev_datum' találat.
 *
 * A mentést nem blokkolja (a pontos TAJ-ütközést a POST /api/patients 409-e
 * kezeli); célja, hogy a felvevő már gépelés közben lássa, ha a beteg
 * valószínűleg már szerepel a rendszerben.
 *
 * Adatvédelem: admin és fogpótlástanász teljes nevet + beteg-linket kap;
 * beutaló orvos csak maszkolt címkét (monogram + születési év), mert a talált
 * beteg nem feltétlenül az ő betege.
 */
export const GET = roleHandler(['admin', 'fogpótlástanász', 'beutalo_orvos'], async (req, { auth }) => {
  const searchParams = req.nextUrl.searchParams;
  const taj = searchParams.get('taj');
  const nev = searchParams.get('nev');
  const szuletesiDatum = searchParams.get('szuletesiDatum');
  const excludeId = searchParams.get('excludeId');

  const maskResults = auth.role === 'beutalo_orvos';
  const pool = getDbPool();
  const matches: DuplicateMatch[] = [];
  const seenIds = new Set<string>();
  if (excludeId) seenIds.add(excludeId);

  const toMatch = (
    row: { id: string; nev: string | null; szuletesi_datum: string | Date | null },
    matchType: DuplicateMatch['matchType']
  ): DuplicateMatch =>
    maskResults
      ? {
          matchType,
          patientId: null,
          displayLabel: maskedPatientLabel(row.nev, row.szuletesi_datum),
          masked: true,
        }
      : {
          matchType,
          patientId: row.id,
          displayLabel: row.nev || 'Név nélküli beteg',
          masked: false,
        };

  if (isSearchableTaj(taj)) {
    const tajResult = await pool.query(
      `SELECT id, nev, szuletesi_datum FROM patients
       WHERE REPLACE(taj, '-', '') = $1
       LIMIT 5`,
      [normalizeTaj(taj)]
    );
    for (const row of tajResult.rows) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      matches.push(toMatch(row, 'taj'));
    }
  }

  if (nev && nev.trim().length > 0 && szuletesiDatum && /^\d{4}-\d{2}-\d{2}$/.test(szuletesiDatum)) {
    const dobResult = await pool.query(
      `SELECT id, nev, szuletesi_datum FROM patients
       WHERE szuletesi_datum = $1
       LIMIT ${DOB_CANDIDATE_LIMIT}`,
      [szuletesiDatum]
    );
    for (const row of dobResult.rows) {
      if (seenIds.has(row.id)) continue;
      if (!namesSimilar(nev, row.nev)) continue;
      seenIds.add(row.id);
      matches.push(toMatch(row, 'nev_datum'));
    }
  }

  return NextResponse.json({ matches });
});
