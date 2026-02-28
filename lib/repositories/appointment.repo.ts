import type { Pool } from 'pg';

export class AppointmentRepository {
  constructor(private pool: Pool) {}

  async findById(id: string) {
    const result = await this.pool.query(
      `SELECT a.id, a.patient_id as "patientId", a.episode_id as "episodeId",
              a.time_slot_id as "timeSlotId", a.created_by as "createdBy",
              a.dentist_email as "dentistEmail", a.appointment_type as "appointmentType",
              a.appointment_status as "appointmentStatus", a.pool,
              a.duration_minutes as "durationMinutes",
              a.google_calendar_event_id as "googleCalendarEventId",
              a.step_code as "stepCode", a.step_seq as "stepSeq",
              a.created_at as "createdAt",
              ats.start_time as "startTime", ats.cim, ats.teremszam,
              ats.dentist_user_id as "dentistUserId"
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE a.id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findByPatientId(patientId: string) {
    const result = await this.pool.query(
      `SELECT a.id, a.patient_id as "patientId", a.episode_id as "episodeId",
              a.time_slot_id as "timeSlotId", a.appointment_type as "appointmentType",
              a.appointment_status as "appointmentStatus", a.pool,
              a.step_code as "stepCode", a.created_at as "createdAt",
              ats.start_time as "startTime", ats.cim, ats.teremszam
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE a.patient_id = $1
       ORDER BY ats.start_time DESC`,
      [patientId]
    );
    return result.rows;
  }

  async countByPatientId(patientId: string): Promise<number> {
    const result = await this.pool.query(
      'SELECT COUNT(*)::int as count FROM appointments WHERE patient_id = $1',
      [patientId]
    );
    return result.rows[0].count;
  }

  async findTimeSlotById(slotId: string) {
    const result = await this.pool.query(
      `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       WHERE ats.id = $1`,
      [slotId]
    );
    return result.rows[0] ?? null;
  }

  async findAvailableSlots(options: { dentistEmail?: string; after?: Date; limit?: number } = {}) {
    const conditions: string[] = ["ats.status = 'available'"];
    const params: any[] = [];
    let paramIdx = 1;

    if (options.dentistEmail) {
      conditions.push(`u.email = $${paramIdx}`);
      params.push(options.dentistEmail);
      paramIdx++;
    }

    if (options.after) {
      conditions.push(`ats.start_time > $${paramIdx}`);
      params.push(options.after.toISOString());
      paramIdx++;
    }

    const limit = options.limit ?? 100;

    const result = await this.pool.query(
      `SELECT ats.id, ats.start_time as "startTime", ats.status, ats.cim,
              ats.teremszam, u.email as "dentistEmail", u.doktor_neve as "dentistName"
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ats.start_time ASC
       LIMIT $${paramIdx}`,
      [...params, limit]
    );
    return result.rows;
  }
}
