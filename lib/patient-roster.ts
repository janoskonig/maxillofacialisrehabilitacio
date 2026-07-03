import { getDbPool } from './db';
import type { PatientRosterEntry } from './patient-name-recognition';

/**
 * A teljes beteg-névsor a szabad-szöveges felismeréshez. Egy praxis névsora
 * kicsi, ezért modul-szinten, rövid TTL-lel cache-eljük — a composer debounce-olt
 * `/api/patients/recognize` hívásai és a küldéskori szerveroldali felismerés
 * (`sendDoctorMessage`) így nem terhelik feleslegesen a DB-t. A folyamat-szintű
 * cache a szerver-újraindításig (vagy a TTL lejártáig) él.
 */
const ROSTER_TTL_MS = 60_000;
let rosterCache: { at: number; roster: PatientRosterEntry[] } | null = null;

export async function getPatientRoster(): Promise<PatientRosterEntry[]> {
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
