import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { fetchQualitySummary } from '@/lib/research-registry/quality-summary';
import { getStepLabelMap } from '@/lib/step-labels';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const [nextAppointmentsResult, pendingAppointmentsResult, newRegistrationsResult, qualitySummary] =
    await Promise.all([
    pool.query(
      `SELECT
        a.id,
        a.patient_id as "patientId",
        ats.start_time as "startTime",
        p.nev as "patientName",
        p.taj as "patientTaj",
        ats.cim,
        ats.teremszam,
        a.appointment_status as "appointmentStatus",
        a.completion_notes as "completionNotes",
        a.is_late as "isLate",
        a.dentist_email as "dentistEmail",
        u.doktor_neve as "dentistName",
        a.appointment_type as "appointmentType",
        a.type_label as "typeLabel",
        a.episode_id as "episodeId",
        a.step_code as "stepCode",
        a.work_phase_id as "workPhaseId",
        a.attempt_number as "attemptNumber",
        ewp.custom_label as "customLabel",
        ewp.work_phase_code as "workPhaseCode",
        -- "Rebook needed": a plan-step appointment whose outcome released the
        -- step (no-show / cancel / unsuccessful), the linked work phase is back
        -- to 'pending', and no other active appointment already covers it. This
        -- is the signal the dashboard turns into the "Újrafoglalás" prompt.
        (
          a.episode_id IS NOT NULL
          AND a.appointment_status IN ('no_show','cancelled_by_doctor','cancelled_by_patient','unsuccessful')
          AND EXISTS (
            SELECT 1 FROM episode_work_phases ewp2
            WHERE ewp2.episode_id = a.episode_id
              AND (ewp2.id = a.work_phase_id OR (a.work_phase_id IS NULL AND ewp2.work_phase_code = a.step_code))
              AND ewp2.status = 'pending'
          )
          AND NOT EXISTS (
            SELECT 1 FROM appointments a2
            WHERE a2.episode_id = a.episode_id
              AND a2.step_code = a.step_code
              AND a2.id <> a.id
              AND (a2.appointment_status IS NULL
                   OR a2.appointment_status NOT IN ('cancelled_by_doctor','cancelled_by_patient','no_show','unsuccessful'))
          )
        ) as "rebookNeeded"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      LEFT JOIN LATERAL (
        SELECT ewp.custom_label, ewp.work_phase_code
        FROM episode_work_phases ewp
        WHERE ewp.episode_id = a.episode_id
          AND (ewp.id = a.work_phase_id OR (a.work_phase_id IS NULL AND ewp.work_phase_code = a.step_code))
        ORDER BY (ewp.id = a.work_phase_id) DESC
        LIMIT 1
      ) ewp ON true
      WHERE ats.start_time >= $1
      AND ats.start_time <= $2
      ORDER BY ats.start_time ASC`,
      [todayStart.toISOString(), todayEnd.toISOString()]
    ),
    pool.query(
      `SELECT 
        a.id,
        a.patient_id as "patientId",
        ats.start_time as "startTime",
        p.nev as "patientName",
        p.taj as "patientTaj",
        ats.cim,
        ats.teremszam,
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        u.doktor_neve as "dentistName"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      WHERE a.approval_status = 'pending'
      AND ats.start_time >= NOW()
      ORDER BY ats.start_time ASC`
    ),
    pool.query(
      `SELECT 
        p.id,
        p.nev,
        p.taj,
        p.email,
        p.telefonszam,
        p.szuletesi_datum,
        p.nem,
        p.cim,
        p.varos,
        p.iranyitoszam,
        r.beutalo_orvos,
        r.beutalo_indokolas,
        p.created_at,
        p.created_by
      FROM patients p
      LEFT JOIN patient_referral r ON r.patient_id = p.id
      WHERE p.kezeleoorvos_user_id IS NULL
        AND (p.kezeleoorvos IS NULL OR p.kezeleoorvos = '')
        AND p.created_by IS NULL
      ORDER BY p.created_at ASC`
    ),
    fetchQualitySummary(pool),
  ]);

  // Resolve a human-readable step label: custom label → catalog label_hu →
  // humanized code (snake_case → words) so the UI never shows raw codes like
  // "teljes_lemez_anat_lenyomat".
  const stepLabelMap = await getStepLabelMap();
  const humanizeStepCode = (code: string | null): string | null =>
    code ? code.replace(/_/g, ' ') : null;
  const nextAppointments = nextAppointmentsResult.rows.map((row) => {
    const { customLabel, workPhaseCode, stepCode, ...rest } = row;
    const stepLabel =
      customLabel ??
      (workPhaseCode ? stepLabelMap.get(workPhaseCode) : undefined) ??
      (stepCode ? stepLabelMap.get(stepCode) : undefined) ??
      humanizeStepCode(workPhaseCode ?? stepCode);
    return { ...rest, stepCode, stepLabel };
  });

  return NextResponse.json({
    nextAppointments,
    pendingAppointments: pendingAppointmentsResult.rows,
    newRegistrations: newRegistrationsResult.rows,
    qualitySummary: qualitySummary.enabled ? qualitySummary : null,
  });
});
