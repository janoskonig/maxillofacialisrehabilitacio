// A „mai időpontok" lekérdezés egyetlen forrása. A főoldali dashboard
// (app/api/dashboard/route.ts) és a dedikált Mai időpontok oldal
// (app/api/appointments/today/route.ts) is ezt használja, hogy a `rebookNeeded`
// számítás és a kapcsolódó mezők egy helyen éljenek.

import type { Pool } from 'pg';

export interface TodaysAppointmentRow {
  id: string;
  patientId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  cim: string | null;
  teremszam: string | null;
  appointmentStatus: string | null;
  completionNotes: string | null;
  isLate: boolean | null;
  dentistEmail: string | null;
  dentistName: string | null;
  appointmentType: string | null;
  typeLabel: string | null;
  episodeId: string | null;
  stepCode: string | null;
  workPhaseId: string | null;
  attemptNumber: number | null;
  stepLabel: string | null;
  rebookNeeded: boolean | null;
}

// "Rebook needed": a plan-step appointment whose outcome released the step
// (no-show / cancel / unsuccessful), the linked work phase is back to 'pending',
// and no other active appointment already covers it. This is the signal turned
// into the "Újrafoglalás" prompt.
export const TODAYS_APPOINTMENTS_QUERY = `
  SELECT
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
    COALESCE(ewp.custom_label, ewp.work_phase_code, a.step_code) as "stepLabel",
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
  ORDER BY ats.start_time ASC
`;

/** A megadott nap [00:00, 23:59:59] ablakára eső időpontok. Alapértelmezés: ma. */
export async function fetchTodaysAppointments(pool: Pool, day: Date = new Date()): Promise<TodaysAppointmentRow[]> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  const result = await pool.query(TODAYS_APPOINTMENTS_QUERY, [start.toISOString(), end.toISOString()]);
  return result.rows as TodaysAppointmentRow[];
}
