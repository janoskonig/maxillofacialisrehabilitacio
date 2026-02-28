import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  const { patientIds } = body;

  if (!Array.isArray(patientIds) || patientIds.length === 0) {
    return NextResponse.json({
      appointments: {},
      opDocuments: {},
      fotoDocuments: {},
      stages: {},
    });
  }

  const pool = getDbPool();
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  const [appointmentResult, opResult, fotoResult, stagesResult] = await Promise.all([
    pool.query(
      `SELECT
         a.patient_id as "patientId",
         a.id,
         a.dentist_email as "dentistEmail",
         a.appointment_status as "appointmentStatus",
         a.completion_notes as "completionNotes",
         a.is_late as "isLate",
         ats.start_time as "startTime",
         u.doktor_neve as "dentistName"
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       LEFT JOIN users u ON a.dentist_email = u.email
       WHERE a.patient_id = ANY($1::uuid[])
         AND ats.start_time >= $2
       ORDER BY ats.start_time ASC`,
      [patientIds, fourHoursAgo]
    ),
    pool.query(
      `SELECT patient_id as "patientId", COUNT(*) as count
       FROM patient_documents
       WHERE patient_id = ANY($1::uuid[])
         AND (tags @> '["orthopantomogram"]'::jsonb OR tags @> '["OP"]'::jsonb
              OR tags::text ILIKE '%orthopantomogram%' OR tags::text ILIKE '%"OP"%')
       GROUP BY patient_id`,
      [patientIds]
    ),
    pool.query(
      `SELECT patient_id as "patientId", COUNT(*) as count
       FROM patient_documents
       WHERE patient_id = ANY($1::uuid[])
         AND (tags @> '["foto"]'::jsonb OR tags::text ILIKE '%"foto"%' OR tags::text ILIKE '%foto%')
       GROUP BY patient_id`,
      [patientIds]
    ),
    (async () => {
      const hasTable = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`
      );
      if (hasTable.rows.length === 0) return { rows: [], legacy: true };

      const r = await pool.query(
        `SELECT DISTINCT ON (se.patient_id)
           se.patient_id as "patientId",
           se.stage_code as "stageCode",
           se.at as "stageDate",
           se.note as "notes",
           se.episode_id as "episodeId",
           sc.label_hu as "stageLabel"
         FROM stage_events se
         JOIN patient_episodes e ON e.id = se.episode_id
         JOIN stage_catalog sc ON sc.code = se.stage_code AND sc.reason = e.reason
         WHERE se.patient_id = ANY($1::uuid[])
         ORDER BY se.patient_id, se.at DESC`,
        [patientIds]
      );
      return r;
    })(),
  ]);

  // Appointments: pick the next upcoming per patient
  const appointments: Record<string, unknown> = {};
  for (const apt of appointmentResult.rows) {
    if (!appointments[apt.patientId]) {
      appointments[apt.patientId] = {
        id: apt.id,
        startTime: apt.startTime,
        dentistEmail: apt.dentistEmail,
        dentistName: apt.dentistName,
        appointmentStatus: apt.appointmentStatus,
        completionNotes: apt.completionNotes,
        isLate: apt.isLate,
      };
    }
  }

  // Document counts
  const opDocuments: Record<string, number> = {};
  for (const row of opResult.rows) {
    opDocuments[row.patientId] = parseInt(row.count, 10);
  }
  const fotoDocuments: Record<string, number> = {};
  for (const row of fotoResult.rows) {
    fotoDocuments[row.patientId] = parseInt(row.count, 10);
  }

  // Stages
  const stages: Record<string, unknown> = {};
  for (const row of stagesResult.rows) {
    stages[row.patientId] = {
      stage: row.stageCode ?? '',
      stageDate: row.stageDate?.toISOString?.() ?? undefined,
      notes: row.notes ?? undefined,
      stageLabel: row.stageLabel ?? undefined,
      episodeId: row.episodeId ?? undefined,
    };
  }

  // Legacy fallback for patients not in stage_events
  const missingStageIds = patientIds.filter((id: string) => !stages[id]);
  if (missingStageIds.length > 0) {
    try {
      const legacyResult = await pool.query(
        `SELECT patient_id as "patientId", episode_id as "episodeId", stage, stage_date as "stageDate", notes
         FROM patient_current_stage
         WHERE patient_id = ANY($1::uuid[])`,
        [missingStageIds]
      );
      for (const row of legacyResult.rows) {
        if (!stages[row.patientId]) {
          stages[row.patientId] = {
            stage: row.stage ?? '',
            stageDate: row.stageDate?.toISOString?.() ?? undefined,
            notes: row.notes ?? undefined,
            episodeId: row.episodeId ?? undefined,
          };
        }
      }
    } catch {
      // patient_current_stage may not exist
    }
  }

  return NextResponse.json({ appointments, opDocuments, fotoDocuments, stages });
});
