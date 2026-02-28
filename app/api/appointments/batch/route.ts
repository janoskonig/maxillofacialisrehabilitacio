import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  const { patientIds } = body;

  if (!Array.isArray(patientIds) || patientIds.length === 0) {
    return NextResponse.json({ appointments: {} }, { status: 200 });
  }

  const pool = getDbPool();

  const now = new Date();
  const fourHoursFromNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);

  const query = `
    SELECT 
      a.patient_id as "patientId",
      a.id,
      a.time_slot_id as "timeSlotId",
      a.created_by as "createdBy",
      a.dentist_email as "dentistEmail",
      a.created_at as "createdAt",
      a.appointment_status as "appointmentStatus",
      a.completion_notes as "completionNotes",
      a.is_late as "isLate",
      ats.start_time as "startTime",
      ats.status,
      ats.cim,
      ats.teremszam,
      u.doktor_neve as "dentistName"
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    LEFT JOIN users u ON a.dentist_email = u.email
    WHERE a.patient_id = ANY($1::uuid[])
      AND ats.start_time >= $2
    ORDER BY ats.start_time ASC
  `;

  const result = await pool.query(query, [
    patientIds,
    fourHoursFromNow.toISOString()
  ]);

  const appointmentsMap: Record<string, any> = {};
  const patientAppointments: Record<string, any[]> = {};

  result.rows.forEach((apt: any) => {
    const patientId = apt.patientId;
    if (!patientAppointments[patientId]) {
      patientAppointments[patientId] = [];
    }
    patientAppointments[patientId].push(apt);
  });

  Object.keys(patientAppointments).forEach((patientId) => {
    const apts = patientAppointments[patientId];
    if (apts.length > 0) {
      const nextApt = apts[0];
      appointmentsMap[patientId] = {
        id: nextApt.id,
        startTime: nextApt.startTime,
        dentistEmail: nextApt.dentistEmail,
        dentistName: nextApt.dentistName,
        appointmentStatus: nextApt.appointmentStatus,
        completionNotes: nextApt.completionNotes,
        isLate: nextApt.isLate,
      };
    }
  });

  return NextResponse.json({ appointments: appointmentsMap }, { status: 200 });
});
