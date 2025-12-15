import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { sendEmail } from '@/lib/email';

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
 * Request new appointment (without time slot selection)
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
    const { beutaloOrvos, beutaloIndokolas } = body;

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
