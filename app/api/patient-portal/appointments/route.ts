import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { sendEmail, sendAppointmentBookingNotification, sendAppointmentBookingNotificationToPatient, sendAppointmentBookingNotificationToAdmins } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';

/**
 * Get patient's appointments
 * GET /api/patient-portal/appointments
 */
export async function GET(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    const result = await pool.query(
      `SELECT 
        a.id,
        a.patient_id as "patientId",
        a.time_slot_id as "timeSlotId",
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        a.created_at as "createdAt",
        a.appointment_status as "appointmentStatus",
        a.approval_status as "approvalStatus",
        ats.start_time as "startTime",
        ats.cim,
        ats.teremszam,
        u.doktor_neve as "dentistName"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      LEFT JOIN users u ON a.dentist_email = u.email
      WHERE a.patient_id = $1
      ORDER BY ats.start_time DESC`,
      [patientId]
    );

    return NextResponse.json({
      appointments: result.rows,
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpontok lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Request new appointment (without time slot selection) OR book appointment directly (with timeSlotId)
 * POST /api/patient-portal/appointments
 */
export async function POST(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { beutaloOrvos, beutaloIndokolas, timeSlotId } = body;

    // If timeSlotId is provided, this is a direct booking
    if (timeSlotId) {
      return await handleDirectBooking(patientId, timeSlotId);
    }

    // Otherwise, this is a request for appointment (existing functionality)

    const pool = getDbPool();

    // Get patient info
    const patientResult = await pool.query(
      'SELECT id, email, nev, taj FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];

    if (!patient.email || patient.email.trim() === '') {
      return NextResponse.json(
        { error: 'Email cím szükséges az időpont kéréséhez' },
        { status: 400 }
      );
    }

    // Update patient's referring doctor information if provided
    if (beutaloOrvos || beutaloIndokolas) {
      const updateFields: string[] = [];
      const updateValues: (string | null)[] = [];
      let paramIndex = 1;

      if (beutaloOrvos !== undefined) {
        updateFields.push(`beutalo_orvos = $${paramIndex}`);
        updateValues.push(beutaloOrvos?.trim() || null);
        paramIndex++;
      }

      if (beutaloIndokolas !== undefined) {
        updateFields.push(`beutalo_indokolas = $${paramIndex}`);
        updateValues.push(beutaloIndokolas?.trim() || null);
        paramIndex++;
      }

      if (updateFields.length > 0) {
        updateValues.push(patientId);
        await pool.query(
          `UPDATE patients 
           SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
           WHERE id = $${paramIndex}`,
          updateValues
        );
      }
    }

    // Send notification email to admins
    try {
      const adminResult = await pool.query(
        'SELECT email FROM users WHERE role = $1 AND active = true',
        ['admin']
      );
      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);

      if (adminEmails.length > 0) {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Új időpont kérés a páciens portálról</h2>
            <p>Kedves adminisztrátor,</p>
            <p>Egy páciens új időpontot kért a páciens portálon keresztül:</p>
            <ul>
              <li><strong>Beteg neve:</strong> ${patient.nev || 'Név nélküli'}</li>
              <li><strong>TAJ szám:</strong> ${patient.taj || 'Nincs megadva'}</li>
              <li><strong>Email cím:</strong> ${patient.email}</li>
              ${beutaloOrvos ? `<li><strong>Beutaló orvos:</strong> ${beutaloOrvos}</li>` : ''}
              ${beutaloIndokolas ? `<li><strong>Beutalás indoka:</strong> ${beutaloIndokolas}</li>` : ''}
            </ul>
            <p>Kérjük, jelentkezzen be a rendszerbe és válasszon időpontot a páciens számára.</p>
            <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
          </div>
        `;

        await sendEmail({
          to: adminEmails,
          subject: 'Új időpont kérés a páciens portálról - Maxillofaciális Rehabilitáció',
          html,
        });
      }
    } catch (emailError) {
      console.error('Hiba az értesítő email küldésekor:', emailError);
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      message: 'Időpont kérés sikeresen elküldve. Az adminisztráció hamarosan felveszi Önnel a kapcsolatot.',
    });
  } catch (error) {
    console.error('Error requesting appointment:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont kérésekor' },
      { status: 500 }
    );
  }
}

/**
 * Handle direct booking of an appointment
 */
async function handleDirectBooking(patientId: string, timeSlotId: string) {
  const pool = getDbPool();
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

  // Start transaction
  await pool.query('BEGIN');

  try {
    // Get patient info
    const patientResult = await pool.query(
      'SELECT id, email, nev, taj, nem FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];

    // Check if time slot exists and is available
    const timeSlotResult = await pool.query(
      `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id, u.doktor_neve as dentist_name
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       WHERE ats.id = $1`,
      [timeSlotId]
    );

    if (timeSlotResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const timeSlot = timeSlotResult.rows[0];

    if (timeSlot.status !== 'available') {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Ez az időpont már le van foglalva' },
        { status: 400 }
      );
    }

    // Check if time slot is in the future
    const startTime = new Date(timeSlot.start_time);
    if (startTime <= new Date()) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Csak jövőbeli időpontot lehet foglalni' },
        { status: 400 }
      );
    }

    // Create appointment
    const appointmentResult = await pool.query(
      `INSERT INTO appointments (patient_id, time_slot_id, created_by, dentist_email)
       VALUES ($1, $2, $3, $4)
       RETURNING 
         id,
         patient_id as "patientId",
         time_slot_id as "timeSlotId",
         created_by as "createdBy",
         dentist_email as "dentistEmail",
         created_at as "createdAt"`,
      [patientId, timeSlotId, 'patient-portal', timeSlot.dentist_email]
    );

    const appointment = appointmentResult.rows[0];

    // Update time slot status to booked
    await pool.query(
      `UPDATE available_time_slots SET status = 'booked' WHERE id = $1`,
      [timeSlotId]
    );

    await pool.query('COMMIT');

    // Get appointment details for email
    const appointmentCim = timeSlot.cim || DEFAULT_CIM;
    const appointmentTeremszam = timeSlot.teremszam || null;
    const dentistFullName = timeSlot.dentist_name || timeSlot.dentist_email;

    // Generate ICS file
    const icsFileData = {
      patientName: patient.nev,
      patientTaj: patient.taj,
      startTime: startTime,
      surgeonName: 'Páciens portál',
      dentistName: dentistFullName,
    };
    const icsFile = await generateIcsFile(icsFileData);

    // Send email notifications
    try {
      const [adminResult] = await Promise.all([
        pool.query('SELECT email FROM users WHERE role = $1 AND active = true', ['admin']),
      ]);

      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
      const adminEmail = adminEmails.length > 0 ? adminEmails[0] : '';

      await Promise.all([
        // Email to dentist
        sendAppointmentBookingNotification(
          timeSlot.dentist_email,
          patient.nev,
          patient.taj,
          startTime,
          'Páciens portál',
          icsFile,
          appointmentCim,
          appointmentTeremszam
        ),
        // Email to patient if email is available
        patient.email && patient.email.trim() !== ''
          ? sendAppointmentBookingNotificationToPatient(
              patient.email,
              patient.nev,
              patient.nem,
              startTime,
              dentistFullName,
              timeSlot.dentist_email,
              icsFile,
              appointmentCim,
              appointmentTeremszam,
              adminEmail
            )
          : Promise.resolve(),
        // Email to admins
        adminEmails.length > 0
          ? sendAppointmentBookingNotificationToAdmins(
              adminEmails,
              patient.nev,
              patient.taj,
              startTime,
              'Páciens portál',
              timeSlot.dentist_email,
              icsFile,
              appointmentCim,
              appointmentTeremszam
            )
          : Promise.resolve(),
      ]);
    } catch (emailError) {
      console.error('Hiba az értesítő email küldésekor:', emailError);
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      appointment,
      message: 'Időpont sikeresen lefoglalva!',
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error booking appointment:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont foglalásakor' },
      { status: 500 }
    );
  }
}
