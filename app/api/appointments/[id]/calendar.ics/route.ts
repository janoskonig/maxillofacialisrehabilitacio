import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { generateIcsFile } from '@/lib/calendar';

// Download .ics file for an appointment
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Get appointment details
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
      [params.id]
    );

    if (appointmentResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Foglalás nem található' },
        { status: 404 }
      );
    }

    const appointment = appointmentResult.rows[0];

    // Check permissions: surgeon can only download their own appointments
    if (auth.role === 'sebészorvos' && appointment.created_by !== auth.email) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ehhez a foglaláshoz' },
        { status: 403 }
      );
    }

    // Generate .ics file
    const icsFile = await generateIcsFile({
      patientName: appointment.patient_name,
      patientTaj: appointment.patient_taj,
      startTime: new Date(appointment.start_time),
      surgeonName: appointment.created_by,
      dentistName: appointment.dentist_email || 'Fogpótlástanász',
    });

    // Return as download
    return new NextResponse(icsFile.toString('utf-8'), {
      headers: {
        'Content-Type': 'text/calendar',
        'Content-Disposition': `attachment; filename="appointment-${params.id}.ics"`,
      },
    });
  } catch (error) {
    console.error('Error generating calendar file:', error);
    return NextResponse.json(
      { error: 'Hiba történt a naptár fájl generálásakor' },
      { status: 500 }
    );
  }
}

