import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { sendNewAppointmentRequestToAdmin } from '@/lib/email';
import { handleApiError } from '@/lib/api-error-handler';

/**
 * Request a new appointment (via email link)
 * This marks the pending appointment as rejected and notifies admins
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Érvénytelen vagy hiányzó token' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Find appointment by token
    const appointmentResult = await pool.query(
      `SELECT a.*, p.nev as patient_name, p.taj as patient_taj, p.email as patient_email,
              ats.start_time
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE a.approval_token = $1 AND a.approval_status = 'pending'`,
      [token]
    );

    if (appointmentResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Érvénytelen vagy lejárt token, vagy az időpont már nem vár jóváhagyásra' },
        { status: 404 }
      );
    }

    const appointment = appointmentResult.rows[0];

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Update appointment status to rejected (patient wants a new one)
      await pool.query(
        'UPDATE appointments SET approval_status = $1 WHERE id = $2',
        ['rejected', appointment.id]
      );

      // Free the time slot
      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['available', appointment.time_slot_id]
      );

      await pool.query('COMMIT');

      // Send notification to admins
      try {
        const adminResult = await pool.query(
          'SELECT email FROM users WHERE role = $1 AND active = true',
          ['admin']
        );
        const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);

        if (adminEmails.length > 0) {
          await sendNewAppointmentRequestToAdmin(
            adminEmails,
            appointment.patient_name,
            appointment.patient_taj,
            appointment.patient_email,
            new Date(appointment.start_time),
            appointment.id
          );
        }
      } catch (emailError) {
        console.error('Failed to send new appointment request notification:', emailError);
        // Don't fail the request if email fails
      }

      // Return success page HTML
      const html = `
        <!DOCTYPE html>
        <html lang="hu">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Új időpont kérése</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background-color: #f5f5f5;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 500px;
            }
            h1 { color: #3b82f6; }
            p { color: #6b7280; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔄 Új időpont kérése</h1>
            <p>Köszönjük! Kérését rögzítettük.</p>
            <p>Az adminisztrátorok hamarosan felveszik Önnel a kapcsolatot egy új időponttal kapcsolatban.</p>
          </div>
        </body>
        </html>
      `;

      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Hiba történt az új időpont kérésének rögzítésekor');
  }
}

