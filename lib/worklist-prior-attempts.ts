/**
 * Worklist enrichment: korábbi próbák (`attempt_number`) hozzáfűzése.
 *
 * Migration 029 vezette be az `appointments.attempt_number / attempt_failed_*`
 * mezőket. A worklist UI (PatientWorklistWidget, WorklistWidget) "minden próba
 * külön sor" módban jeleníti meg az előzményt — sikertelen + meg-nem-jelent
 * próbák a fősor (BOOKED/COMPLETED) FÖLÖTT, attempt-szám szerint növekvő
 * sorrendben.
 *
 * Backward-compat: ha a `attempt_number` oszlop hiányzik (pre-029 DB), a
 * függvény semmit sem csinál (probe + try/catch), és a `priorAttempts` üres
 * marad.
 */

import type { Pool } from 'pg';
import type { AppointmentAttemptSummary, WorklistItemBackend } from '@/lib/worklist-types';
import { probeAttemptColumns } from '@/lib/appointment-attempts';

interface AttemptRow {
  id: string;
  episode_id: string;
  step_code: string | null;
  work_phase_id: string | null;
  attempt_number: number;
  appointment_status: 'unsuccessful' | 'no_show' | 'completed' | null;
  start_time: Date | string | null;
  end_time: Date | string | null;
  dentist_email: string | null;
  attempt_failed_reason: string | null;
  attempt_failed_at: Date | string | null;
  attempt_failed_by: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * A `items` tömbön IN-PLACE módosítja a `priorAttempts`, `currentAppointmentId`,
 * `currentAppointmentStatus` és `currentAttemptNumber` mezőket.
 *
 * "Korábbi próba" definíciója:
 *   • appointment, ami `unsuccessful` vagy `no_show` státuszú, vagy
 *   • `completed` státuszú, de NEM az aktuális (`bookedAppointmentId`) sor.
 *
 * A `cancelled_*` és NULL státuszú appointmentek nem korábbi próbák — előbbi
 * a vizit meg sem történt, utóbbi az aktuális pending foglalás (= a fősor).
 */
export async function enrichWorklistPriorAttempts(
  pool: Pool,
  items: WorklistItemBackend[]
): Promise<void> {
  if (items.length === 0) return;

  const hasAttemptColumns = await probeAttemptColumns(pool);
  if (!hasAttemptColumns) return;

  // Csak azokra az itemekre kérünk, ahol értelmes a (episode_id, step_code) kulcs.
  const lookupKeys = new Set<string>();
  for (const item of items) {
    if (item.episodeId && item.stepCode) {
      lookupKeys.add(`${item.episodeId}::${item.stepCode}`);
    }
  }
  if (lookupKeys.size === 0) return;

  const episodeIds = Array.from(new Set(items.map((i) => i.episodeId).filter(Boolean)));
  const stepCodes = Array.from(new Set(items.map((i) => i.stepCode).filter(Boolean) as string[]));
  if (episodeIds.length === 0 || stepCodes.length === 0) return;

  // Egyetlen lekérés a teljes batch-re. A WHERE feltétel az összes (ep, step)
  // párt lefedi, a TS oldalon szűrjük a tényleges item-ekre. A work_phase_id
  // oszlop a 025-ös migrációval jött; a 029 (attempt_number, amire a probe már
  // szűrt) későbbi, így itt biztosan létezik.
  //
  // WP-4.1b mellékjavítás: a korábbi `ats.end_time` hivatkozás a mai sémán
  // (az available_time_slots-nak NINCS end_time oszlopa) minden hívásnál
  // elhasalt, és a catch némán elnyelte — a priorAttempts enrichment így
  // valójában soha nem futott le. A slot-oldali end_time-ot a
  // start_time + duration_minutes képletből számoljuk.
  let rows: AttemptRow[];
  try {
    const result = await pool.query<AttemptRow>(
      `SELECT a.id,
              a.episode_id,
              a.step_code,
              a.work_phase_id,
              a.attempt_number,
              a.appointment_status,
              COALESCE(a.start_time, ats.start_time) AS start_time,
              COALESCE(
                a.end_time,
                ats.start_time + make_interval(mins => COALESCE(ats.duration_minutes, 30))
              ) AS end_time,
              a.dentist_email,
              a.attempt_failed_reason,
              a.attempt_failed_at,
              a.attempt_failed_by
         FROM appointments a
         LEFT JOIN available_time_slots ats ON ats.id = a.time_slot_id
        WHERE a.episode_id = ANY($1::uuid[])
          AND a.step_code  = ANY($2::text[])
          AND a.appointment_status IN ('unsuccessful', 'no_show', 'completed')
        ORDER BY a.episode_id, a.step_code, a.attempt_number ASC, a.start_time ASC`,
      [episodeIds, stepCodes]
    );
    rows = result.rows;
  } catch {
    // Pre-029 DB-n a status CHECK constraint nem ismeri az 'unsuccessful'-t —
    // de a probe már szűrt erre. Ide csak akkor jutunk, ha valami egyéb hiba.
    return;
  }

  // Csoportosítás — WP-4.1b: work_phase_id-elsődleges identitás.
  //   • byWorkPhase: a work_phase_id-vel linkelt sorok, fázisonként külön —
  //     duplikált work_phase_code-nál ("N alkalom ugyanabból a fázisból") a
  //     testvér-fázis próbái nem keveredhetnek.
  //   • byCodeLegacy: a work_phase_id IS NULL (legacy) sorok (ep, step_code)
  //     szerint — ezek a workPhaseId-s itemekhez is hozzátartoznak fallbackként.
  //   • byCodeAll: MINDEN sor (ep, step_code) szerint — a workPhaseId nélküli
  //     itemek a korábbi viselkedést kapják (nincs miből fázisra szűkíteni).
  const byWorkPhase = new Map<string, AttemptRow[]>();
  const byCodeLegacy = new Map<string, AttemptRow[]>();
  const byCodeAll = new Map<string, AttemptRow[]>();
  const push = (map: Map<string, AttemptRow[]>, key: string, row: AttemptRow): void => {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(row);
  };
  for (const row of rows) {
    if (!row.step_code) continue;
    const codeKey = `${row.episode_id}::${row.step_code}`;
    if (!lookupKeys.has(codeKey)) continue;
    push(byCodeAll, codeKey, row);
    if (row.work_phase_id) {
      push(byWorkPhase, row.work_phase_id, row);
    } else {
      push(byCodeLegacy, codeKey, row);
    }
  }

  const attemptSortKey = (r: AttemptRow): [number, number] => [
    Number(r.attempt_number ?? 1),
    r.start_time ? new Date(r.start_time).getTime() : 0,
  ];

  // Item-szintű döntés: a `bookedAppointmentId` (ha van) az "aktuális" sor;
  // minden más a `priorAttempts`-be megy. Ha nincs bookedAppointmentId, és
  // van `completed` row, az lesz az aktuális (COMPLETED state UI-on); minden
  // korábbi `unsuccessful`/`no_show` előtte.
  for (const item of items) {
    if (!item.episodeId || !item.stepCode) continue;
    const codeKey = `${item.episodeId}::${item.stepCode}`;
    let list: AttemptRow[];
    if (item.workPhaseId) {
      // Fázis-linkelt próbák + a legacy (link nélküli) sorok fallbackje,
      // a batch-lekérés eredeti (attempt_number, start_time) rendezésével.
      list = [
        ...(byWorkPhase.get(item.workPhaseId) ?? []),
        ...(byCodeLegacy.get(codeKey) ?? []),
      ].sort((a, b) => {
        const [an, at] = attemptSortKey(a);
        const [bn, bt] = attemptSortKey(b);
        return an - bn || at - bt;
      });
    } else {
      list = byCodeAll.get(codeKey) ?? [];
    }

    let currentRow: AttemptRow | undefined;
    if (item.bookedAppointmentId) {
      currentRow = list.find((r) => r.id === item.bookedAppointmentId);
    } else {
      // BOOKED foglalás nélkül: a legutolsó completed (vagy ha nincs, semmi)
      // számít aktuálisnak. Az unsuccessful/no_show NEM "current" — azok mind
      // priorAttempts-be kerülnek.
      currentRow = [...list].reverse().find((r) => r.appointment_status === 'completed');
    }

    const priorRows = list.filter((r) => r.id !== currentRow?.id);
    item.priorAttempts = priorRows.map<AppointmentAttemptSummary>((r) => ({
      appointmentId: r.id,
      attemptNumber: Number(r.attempt_number ?? 1),
      status: (r.appointment_status as 'unsuccessful' | 'no_show' | 'completed') ?? 'completed',
      startTime: toIso(r.start_time),
      endTime: toIso(r.end_time),
      providerEmail: r.dentist_email,
      failedReason: r.attempt_failed_reason,
      failedAt: toIso(r.attempt_failed_at),
      failedBy: r.attempt_failed_by,
    }));

    if (currentRow) {
      item.currentAppointmentId = currentRow.id;
      item.currentAttemptNumber = Number(currentRow.attempt_number ?? 1);
      item.currentAppointmentStatus =
        currentRow.appointment_status === 'completed'
          ? 'completed'
          : currentRow.appointment_status === 'no_show'
            ? 'no_show'
            : 'pending';
    } else if (item.bookedAppointmentId) {
      // BOOKED de a list nem tartalmazza (mert NULL státuszú = pending) —
      // ez az aktuális próba; sorszáma = a priorAttempts száma + 1.
      item.currentAppointmentId = item.bookedAppointmentId;
      item.currentAttemptNumber = item.priorAttempts.length + 1;
      item.currentAppointmentStatus = 'pending';
    }
  }
}
