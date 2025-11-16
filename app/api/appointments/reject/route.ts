import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { handleApiError } from '@/lib/api-error-handler';

/**
 * Reject a pending appointment (via email link)
 * This cancels the pending appointment and frees the time slot
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
      `SELECT a.*, ats.start_time
       FROM appointments a
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
      // Update appointment status to rejected
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

      // Return success page HTML
      const html = `
        <!DOCTYPE html>
        <html lang="hu">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Időpont elvetve</title>
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
            h1 { color: #ef4444; }
            p { color: #6b7280; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Időpont elvetve</h1>
            <p>Az időpontfoglalást elvetettük.</p>
            <p>Ha új időpontot szeretne, kérjük, lépjen kapcsolatba velünk.</p>
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
    return handleApiError(error, 'Hiba történt az időpont elvetésekor');
  }
}

