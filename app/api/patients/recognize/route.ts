import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import {
  recognizePatientsInText,
  type PatientRosterEntry,
} from '@/lib/patient-name-recognition';

export const dynamic = 'force-dynamic';

// A teljes beteg-névsor a felismeréshez. Egy praxis névsora kicsi, ezért
// modul-szinten, rövid TTL-lel cache-eljük — a composer debounce-olt hívásai
// így nem terhelik a DB-t. (A folyamat-szintű cache a szerver-újraindításig él.)
const ROSTER_TTL_MS = 60_000;
let rosterCache: { at: number; roster: PatientRosterEntry[] } | null = null;

async function getRoster(): Promise<PatientRosterEntry[]> {
  if (rosterCache && Date.now() - rosterCache.at < ROSTER_TTL_MS) {
    return rosterCache.roster;
  }
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT id, nev, taj FROM patients WHERE nev IS NOT NULL AND TRIM(nev) != ''`,
  );
  const roster: PatientRosterEntry[] = result.rows.map((r: any) => ({
    id: r.id,
    nev: r.nev,
    taj: r.taj ?? null,
  }));
  rosterCache = { at: Date.now(), roster };
  return roster;
}

/**
 * POST /api/patients/recognize — felismeri a szabad szövegben említett betegeket
 * (teljes név + TAJ). A composer ezzel jeleníti meg a megerősítő sávot.
 */
export const POST = authedHandler(async (req) => {
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text : '';

  if (!text.trim()) {
    return NextResponse.json({ detections: [] });
  }

  const roster = await getRoster();
  const detections = recognizePatientsInText(text, roster);

  return NextResponse.json({ detections });
});
