import { getDbPool } from '@/lib/db';
import { getOhipPatientContext } from '@/lib/ohip14-stage';
import {
  getTimepointAvailability,
  type TimepointAvailability,
} from '@/lib/ohip14-timepoint-stage';
import { OHIP_ESCALATION_AFTER } from '@/lib/ohip14-patient-tasks';
import { OHIP14_TIMEPOINTS, type OHIP14Timepoint } from '@/lib/types';

const ALL_TIMEPOINTS: readonly OHIP14Timepoint[] = OHIP14_TIMEPOINTS;

/**
 * OHIP-14 válaszarány-tölcsér (adatminőség / torzítás-monitorozás).
 *
 * A kérdőíves utánkövetés legnagyobb kockázata a nem véletlenszerű
 * lemorzsolódás: ha a T1–T5 kitöltési arány szisztematikusan esik, a
 * QoL-kimenetek torzulnak. Ez a modul betegenként/időpontonként élőben
 * osztályozza az állapotot (kitöltött / nyitott ablak / kihagyott ablak /
 * még nem nyílt meg), és hozzáteszi az emlékeztető- és eszkalációs
 * lépcsőket az ohip_reminder_log alapján — ugyanazzal a jogosultsági
 * logikával, mint az emlékeztető-küldő job (lib/ohip14-reminders.ts).
 */

export type OhipTimepointStatus = 'completed' | 'pending_open' | 'missed' | 'not_open';

export interface OhipFunnelTimepointRow {
  timepoint: OHIP14Timepoint;
  /** Valaha jogosult volt: kitöltött + nyitott + kihagyott. */
  eligible: number;
  completed: number;
  pendingOpen: number;
  missed: number;
  notOpen: number;
  /** Nyitott (nem kitöltött) esetből hánynak ment már legalább egy emlékeztető. */
  reminded: number;
  /** Nyitott esetből hány érte el az eszkalációs küszöböt (≥3 emlékeztető). */
  escalated: number;
  /** completed / eligible, ha van jogosult; különben null. */
  completionRate: number | null;
}

export interface OhipFunnelDoctorRow {
  doctor: string;
  eligible: number;
  completed: number;
  pendingOpen: number;
  missed: number;
  completionRate: number | null;
}

export interface OhipFunnelReport {
  computedAt: string;
  /** Nyitott epizódú betegek száma (a tölcsér alappopulációja). */
  totalPatients: number;
  /** E-mail cím nélküli betegek — őket az e-mail emlékeztető nem éri el. */
  withoutEmail: number;
  timepoints: OhipFunnelTimepointRow[];
  byDoctor: OhipFunnelDoctorRow[];
}

/**
 * Egy beteg egy időpontjának állapota. Tiszta függvény — unit-tesztelhető.
 */
export function classifyTimepointStatus(
  timepoint: OHIP14Timepoint,
  isCompleted: boolean,
  avail: TimepointAvailability,
  now: Date = new Date()
): OhipTimepointStatus {
  if (isCompleted) return 'completed';
  if (avail.allowed) return 'pending_open';
  if (timepoint === 'T0') {
    // T0 stádium-kapuzott: ha már nem engedett, a protetikai fázis túllépett
    // rajta → kihagyott baseline.
    return 'missed';
  }
  if (!avail.opensAt) return 'not_open'; // nincs átadás dátum
  if (now < avail.opensAt) return 'not_open';
  if (avail.closesAt && now >= avail.closesAt) return 'missed';
  return 'not_open';
}

function rate(completed: number, eligible: number): number | null {
  if (eligible <= 0) return null;
  return Math.round((completed / eligible) * 1000) / 10; // egy tizedes, %-ban
}

export async function getOhipFunnelReport(): Promise<OhipFunnelReport> {
  const pool = getDbPool();
  const now = new Date();

  const patientsRes = await pool.query(`
    SELECT
      p.id AS patient_id,
      p.email,
      pe.id AS open_episode_id,
      COALESCE(u.doktor_neve, NULLIF(TRIM(p.kezeleoorvos), ''), 'Nincs kezelőorvos') AS doctor
    FROM patients p
    JOIN patient_episodes pe ON pe.patient_id = p.id AND pe.status = 'open'
    LEFT JOIN users u ON u.id = p.kezeleoorvos_user_id
    ORDER BY p.id
  `);

  const patientIds = patientsRes.rows.map((r: any) => r.patient_id);

  const emptyTimepointRow = (tp: OHIP14Timepoint): OhipFunnelTimepointRow => ({
    timepoint: tp,
    eligible: 0,
    completed: 0,
    pendingOpen: 0,
    missed: 0,
    notOpen: 0,
    reminded: 0,
    escalated: 0,
    completionRate: null,
  });

  const report: OhipFunnelReport = {
    computedAt: now.toISOString(),
    totalPatients: patientsRes.rows.length,
    withoutEmail: patientsRes.rows.filter((r: any) => !r.email || r.email.trim() === '').length,
    timepoints: ALL_TIMEPOINTS.map(emptyTimepointRow),
    byDoctor: [],
  };
  if (patientIds.length === 0) return report;

  // Kitöltött válaszok betegenként/epizódonként/időpontonként.
  const completedRes = await pool.query(
    `SELECT patient_id, episode_id, timepoint FROM ohip14_responses
     WHERE patient_id = ANY($1)`,
    [patientIds]
  );
  const completedKey = new Set(
    completedRes.rows.map((r: any) => `${r.patient_id}|${r.episode_id}|${r.timepoint}`)
  );

  // Emlékeztető-darabszám betegenként/időpontonként.
  const remindersRes = await pool.query(
    `SELECT patient_id, timepoint, count(*)::int AS c FROM ohip_reminder_log
     WHERE patient_id = ANY($1)
     GROUP BY patient_id, timepoint`,
    [patientIds]
  );
  const reminderCount = new Map<string, number>(
    remindersRes.rows.map((r: any) => [`${r.patient_id}|${r.timepoint}`, r.c])
  );

  const tpRowByCode = new Map(report.timepoints.map(row => [row.timepoint, row]));
  const doctorAgg = new Map<string, OhipFunnelDoctorRow>();

  for (const row of patientsRes.rows) {
    const { patient_id, open_episode_id, doctor } = row;
    const ohipCtx = await getOhipPatientContext(pool, patient_id);
    const episodeId = ohipCtx.episodeId ?? open_episode_id;

    let doctorRow = doctorAgg.get(doctor);
    if (!doctorRow) {
      doctorRow = { doctor, eligible: 0, completed: 0, pendingOpen: 0, missed: 0, completionRate: null };
      doctorAgg.set(doctor, doctorRow);
    }

    for (const tp of ALL_TIMEPOINTS) {
      const isCompleted = completedKey.has(`${patient_id}|${episodeId}|${tp}`);
      const avail = getTimepointAvailability(tp, ohipCtx.stageCode, ohipCtx.deliveryDate, now);
      const status = classifyTimepointStatus(tp, isCompleted, avail, now);

      const tpRow = tpRowByCode.get(tp)!;
      if (status === 'completed') {
        tpRow.completed++;
        doctorRow.completed++;
      } else if (status === 'pending_open') {
        tpRow.pendingOpen++;
        doctorRow.pendingOpen++;
        const reminders = reminderCount.get(`${patient_id}|${tp}`) ?? 0;
        if (reminders > 0) tpRow.reminded++;
        if (reminders >= OHIP_ESCALATION_AFTER) tpRow.escalated++;
      } else if (status === 'missed') {
        tpRow.missed++;
        doctorRow.missed++;
      } else {
        tpRow.notOpen++;
      }
    }
  }

  for (const tpRow of report.timepoints) {
    tpRow.eligible = tpRow.completed + tpRow.pendingOpen + tpRow.missed;
    tpRow.completionRate = rate(tpRow.completed, tpRow.eligible);
  }
  report.byDoctor = Array.from(doctorAgg.values())
    .map(d => ({
      ...d,
      eligible: d.completed + d.pendingOpen + d.missed,
      completionRate: rate(d.completed, d.completed + d.pendingOpen + d.missed),
    }))
    .filter(d => d.eligible > 0)
    .sort((a, b) => (a.completionRate ?? 101) - (b.completionRate ?? 101));

  return report;
}
