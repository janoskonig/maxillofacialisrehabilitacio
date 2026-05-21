import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT } from '@/lib/active-appointment';
import { probeAppointmentsWorkPhaseIdColumn } from '@/lib/active-appointment';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/unlinked-appointments
 *
 * Jövőbeli, aktív foglalások ugyanannál a betegnél, amelyek még nincsenek
 * ehhez a munkafázishoz (targetWorkPhaseId) rendelve — epizód nélküli
 * (páciens portál) vagy más fázis / step_code alatt.
 */
export const GET = roleHandler(
  ['admin', 'beutalo_orvos', 'fogpótlástanász'],
  async (req, { params }) => {
    const episodeId = params.id;
    const { searchParams } = new URL(req.url);
    const targetWorkPhaseId = searchParams.get('targetWorkPhaseId');

    const pool = getDbPool();
    const ep = await pool.query(
      `SELECT id, patient_id AS "patientId" FROM patient_episodes WHERE id = $1`,
      [episodeId]
    );
    if (ep.rows.length === 0) {
      return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
    }
    const patientId = ep.rows[0].patientId as string;

    if (targetWorkPhaseId) {
      const twp = await pool.query(
        `SELECT episode_id AS "episodeId" FROM episode_work_phases WHERE id = $1`,
        [targetWorkPhaseId]
      );
      if (twp.rows.length === 0) {
        return NextResponse.json({ error: 'Cél munkafázis nem található' }, { status: 404 });
      }
      if (twp.rows[0].episodeId !== episodeId) {
        return NextResponse.json({ error: 'A munkafázis más epizódhoz tartozik' }, { status: 400 });
      }
    }

    const hasWorkPhaseCol = await probeAppointmentsWorkPhaseIdColumn(pool);
    const workPhaseSelect = hasWorkPhaseCol ? ', a.work_phase_id AS "workPhaseId"' : '';

    const result = await pool.query(
      `SELECT a.id,
              a.episode_id AS "episodeId",
              a.step_code AS "stepCode",
              a.pool,
              a.created_by AS "createdBy"
              ${workPhaseSelect},
              COALESCE(a.start_time, ats.start_time) AS "startTime",
              a.dentist_email AS "dentistEmail",
              ats.slot_purpose AS "slotPurpose"
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE a.patient_id = $1
         AND COALESCE(a.start_time, ats.start_time) > CURRENT_TIMESTAMP
         AND ${SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT}
         AND (
           a.episode_id IS NULL
           OR a.episode_id = $2
         )
         AND ($3::uuid IS NULL OR a.work_phase_id IS DISTINCT FROM $3::uuid)
       ORDER BY COALESCE(a.start_time, ats.start_time) ASC
       LIMIT 30`,
      [patientId, episodeId, targetWorkPhaseId ?? null]
    );

    const appointments = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      episodeId: row.episodeId ?? null,
      stepCode: row.stepCode ?? null,
      workPhaseId: row.workPhaseId ?? null,
      pool: row.pool,
      startTime:
        row.startTime instanceof Date
          ? row.startTime.toISOString()
          : String(row.startTime),
      dentistEmail: row.dentistEmail ?? null,
      createdBy: row.createdBy ?? null,
      slotPurpose: row.slotPurpose ?? null,
      isPatientPortal: row.createdBy === 'patient-portal',
    }));

    return NextResponse.json({ appointments });
  }
);
