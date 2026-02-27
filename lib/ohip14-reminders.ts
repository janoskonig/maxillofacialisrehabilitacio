import { getDbPool } from '@/lib/db';
import { sendOhipReminderEmail } from '@/lib/email';
import { getTimepointAvailability, type TimepointAvailability } from '@/lib/ohip14-timepoint-stage';
import type { OHIP14Timepoint } from '@/lib/types';

const ALL_TIMEPOINTS: OHIP14Timepoint[] = ['T0', 'T1', 'T2', 'T3'];
const REMINDER_COOLDOWN_DAYS = 7;

interface ReminderResult {
  sent: number;
  skipped: number;
  errors: number;
}

/**
 * Find all patients with a pending OHIP timepoint in its open window
 * and send weekly email reminders. Idempotent — checks ohip_reminder_log
 * so the same patient/timepoint pair is not emailed more than once per week.
 */
export async function sendOhipReminders(): Promise<ReminderResult> {
  const pool = getDbPool();
  const result: ReminderResult = { sent: 0, skipped: 0, errors: 0 };
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://rehabilitacios-protetika.hu';

  // 1) Get all patients with open episodes + email
  const patientsRes = await pool.query(`
    SELECT
      p.id AS patient_id,
      p.nev,
      p.nem,
      p.email,
      pe.id AS episode_id
    FROM patients p
    JOIN patient_episodes pe ON pe.patient_id = p.id AND pe.status = 'open'
    WHERE p.email IS NOT NULL AND p.email != ''
    ORDER BY p.id
  `);

  if (patientsRes.rows.length === 0) return result;

  // 2) For each patient, determine pending timepoints
  for (const row of patientsRes.rows) {
    try {
      const { patient_id, nev, nem, email, episode_id } = row;

      // Get current stage
      const stageRes = await pool.query(
        `SELECT stage_code FROM stage_events
         WHERE patient_id = $1 AND episode_id = $2
         ORDER BY at DESC LIMIT 1`,
        [patient_id, episode_id]
      );
      const stageCode = stageRes.rows[0]?.stage_code ?? null;

      // Get delivery date (STAGE_6)
      const deliveryRes = await pool.query(
        `SELECT at FROM stage_events
         WHERE patient_id = $1 AND episode_id = $2 AND stage_code = 'STAGE_6'
         ORDER BY at DESC LIMIT 1`,
        [patient_id, episode_id]
      );
      const deliveryDate: Date | null = deliveryRes.rows[0]?.at ?? null;

      // Get already-completed timepoints for this episode
      const completedRes = await pool.query(
        `SELECT DISTINCT timepoint FROM ohip14_responses
         WHERE patient_id = $1 AND episode_id = $2`,
        [patient_id, episode_id]
      );
      const completedSet = new Set(completedRes.rows.map((r: any) => r.timepoint));

      // Find the first pending timepoint whose window is open
      let pendingTp: OHIP14Timepoint | null = null;
      let pendingAvail: TimepointAvailability | null = null;
      for (const tp of ALL_TIMEPOINTS) {
        if (completedSet.has(tp)) continue;
        const avail = getTimepointAvailability(tp, stageCode, deliveryDate);
        if (avail.allowed) {
          pendingTp = tp;
          pendingAvail = avail;
          break;
        }
      }

      if (!pendingTp || !pendingAvail) {
        result.skipped++;
        continue;
      }

      // Check cooldown (already sent in last 7 days?)
      const recentRes = await pool.query(
        `SELECT 1 FROM ohip_reminder_log
         WHERE patient_id = $1 AND timepoint = $2
           AND sent_at > NOW() - INTERVAL '${REMINDER_COOLDOWN_DAYS} days'
         LIMIT 1`,
        [patient_id, pendingTp]
      );
      if (recentRes.rows.length > 0) {
        result.skipped++;
        continue;
      }

      // Send email
      const portalUrl = `${baseUrl}/patient-portal/ohip14`;
      await sendOhipReminderEmail(
        email,
        nev,
        nem,
        pendingTp,
        pendingAvail.closesAt ?? null,
        portalUrl,
      );

      // Log
      await pool.query(
        `INSERT INTO ohip_reminder_log (patient_id, episode_id, timepoint, email_to)
         VALUES ($1, $2, $3, $4)`,
        [patient_id, episode_id, pendingTp, email]
      );

      result.sent++;
    } catch (err) {
      console.error(`[ohip-reminders] Error for patient ${row.patient_id}:`, err);
      result.errors++;
    }
  }

  return result;
}
