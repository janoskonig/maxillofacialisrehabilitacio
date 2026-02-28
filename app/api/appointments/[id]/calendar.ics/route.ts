import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { generateIcsFile } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const { id } = params;
  const pool = getDbPool();

  const appointmentResult = await pool.query(
    `SELECT 
      a.id,
      a.patient_id,
      a.time_slot_id,
      a.created_by,
      a.dentist_email,
      ats.start_time,
      p.nev as patient_name,
      p.taj as patient_taj
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    JOIN patients p ON a.patient_id = p.id
    WHERE a.id = $1`,
    [id]
  );

  if (appointmentResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Foglalás nem található' },
      { status: 404 }
    );
  }

  const appointment = appointmentResult.rows[0];

  if (auth.role === 'sebészorvos' && appointment.created_by !== auth.email) {
    return NextResponse.json(
      { error: 'Nincs jogosultsága ehhez a foglaláshoz' },
      { status: 403 }
    );
  }

  const icsFile = await generateIcsFile({
    patientName: appointment.patient_name,
    patientTaj: appointment.patient_taj,
    startTime: new Date(appointment.start_time),
    surgeonName: appointment.created_by,
    dentistName: appointment.dentist_email || 'Fogpótlástanász',
  });

  return new NextResponse(icsFile.toString('utf-8'), {
    headers: {
      'Content-Type': 'text/calendar',
      'Content-Disposition': `attachment; filename="appointment-${id}.ics"`,
    },
  });
});
