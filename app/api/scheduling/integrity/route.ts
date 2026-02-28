import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const pool = getDbPool();

  const [oneHardNextViolations, openIntentsClosedEpisodes, apptNoSlot, slotDoubleBooked] =
    await Promise.all([
      pool.query(
        `SELECT pe.id as "episodeId", pe.patient_id as "patientId", array_agg(a.id) as "appointmentIds"
         FROM appointments a
         JOIN patient_episodes pe ON a.episode_id = pe.id
         WHERE a.pool = 'work' AND a.start_time > CURRENT_TIMESTAMP
         AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
         AND a.requires_precommit = false
         GROUP BY pe.id, pe.patient_id
         HAVING COUNT(*) > 1`
      ),
      pool.query(
        `SELECT si.episode_id as "episodeId", array_agg(si.id) as "intentIds"
         FROM slot_intents si
         JOIN patient_episodes pe ON si.episode_id = pe.id
         WHERE si.state = 'open' AND pe.status = 'closed'
         GROUP BY si.episode_id`
      ),
      pool.query(
        `SELECT a.id as "appointmentId", a.time_slot_id as "timeSlotId"
         FROM appointments a
         LEFT JOIN available_time_slots ats ON a.time_slot_id = ats.id
         WHERE ats.id IS NULL
         AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')`
      ),
      pool.query(
        `SELECT time_slot_id as "timeSlotId", array_agg(id) as "appointmentIds"
         FROM appointments
         WHERE (appointment_status IS NULL OR appointment_status = 'completed')
         GROUP BY time_slot_id
         HAVING COUNT(*) > 1`
      ),
    ]);

  const report = {
    generatedAt: new Date().toISOString(),
    oneHardNextViolations: oneHardNextViolations.rows,
    openIntentsClosedEpisodes: openIntentsClosedEpisodes.rows,
    appointmentsWithoutSlot: apptNoSlot.rows,
    slotsDoubleBooked: slotDoubleBooked.rows,
    ok:
      oneHardNextViolations.rows.length === 0 &&
      openIntentsClosedEpisodes.rows.length === 0 &&
      apptNoSlot.rows.length === 0 &&
      slotDoubleBooked.rows.length === 0,
  };

  return NextResponse.json(report);
});
