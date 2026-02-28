import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { handleApiError } from '@/lib/api-error-handler';
import { sendConditionalAppointmentRequestToPatient } from '@/lib/email';
import { logger } from '@/lib/logger';

/**
 * Reject a pending appointment (via email link)
 * This cancels the pending appointment and frees the time slot
 */
export const dynamic = 'force-dynamic';

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

    // Find appointment by token with patient and time slot info
    const appointmentResult = await pool.query(
      `SELECT a.*, ats.start_time, ats.cim, ats.teremszam,
              p.nev as patient_name, p.email as patient_email, p.nem as patient_nem,
              u.doktor_neve, u.email as dentist_email
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       JOIN patients p ON a.patient_id = p.id
       LEFT JOIN users u ON a.dentist_email = u.email
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
    
    // Check if time slot is still valid (can only reject before appointment time)
    const startTime = new Date(appointment.start_time);
    if (startTime <= new Date()) {
      return new NextResponse(`
        <!DOCTYPE html>
        <html lang="hu">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Időpont elmúlt</title>
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
            <h1>✗ Időpont elmúlt</h1>
            <p>Ez az időpont már elmúlt, nem lehet elutasítani.</p>
            <p>Ha kérdése van, kérjük, lépjen kapcsolatba velünk: <a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
          </div>
        </body>
        </html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    
    // Get alternative time slots
    const alternativeIdsRaw = appointment.alternative_time_slot_ids;
    const alternativeIds = Array.isArray(alternativeIdsRaw) 
      ? alternativeIdsRaw 
      : (alternativeIdsRaw ? [alternativeIdsRaw] : []);
    const currentAlternativeIndex = appointment.current_alternative_index;
    
    // Determine next alternative index
    let nextAlternativeIndex: number | null = null;
    if (currentAlternativeIndex === null) {
      // Currently showing primary, show first alternative
      nextAlternativeIndex = alternativeIds.length > 0 ? 0 : null;
    } else if (currentAlternativeIndex < alternativeIds.length - 1) {
      // Show next alternative
      nextAlternativeIndex = currentAlternativeIndex + 1;
    }
    // If no more alternatives, nextAlternativeIndex stays null

    // Start transaction
    await pool.query('BEGIN');

    try {
      if (nextAlternativeIndex !== null) {
        // There's a next alternative, switch to it
        const nextAlternativeId = alternativeIds[nextAlternativeIndex];
        
        // Free current time slot
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['available', appointment.time_slot_id]
        );
        
        // Get next alternative time slot info
        const nextAltSlotResult = await pool.query(
          `SELECT ats.*, u.doktor_neve, u.email as dentist_email
           FROM available_time_slots ats
           JOIN users u ON ats.user_id = u.id
           WHERE ats.id = $1`,
          [nextAlternativeId]
        );
        
        if (nextAltSlotResult.rows.length === 0 || nextAltSlotResult.rows[0].status !== 'available') {
          // Alternative slot no longer available, reject the appointment and free all slots
          await pool.query(
            'UPDATE appointments SET approval_status = $1 WHERE id = $2',
            ['rejected', appointment.id]
          );
          
          // Free all alternative time slots
          const validIds = alternativeIds.filter((id: any) => id && typeof id === 'string');
          if (validIds.length > 0) {
            await pool.query(
              'UPDATE available_time_slots SET status = $1 WHERE id = ANY($2::uuid[])',
              ['available', validIds]
            );
          }
          
          await pool.query('COMMIT');
          
          return new NextResponse(`
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
                <p>Sajnáljuk, de az alternatív időpontok már nem elérhetők.</p>
                <p>Az időpontok újra foglalhatóvá váltak.</p>
                <p>Ha új időpontot szeretne, kérjük, lépjen kapcsolatba velünk: <a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
              </div>
            </body>
            </html>
          `, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        
        const nextAltSlot = nextAltSlotResult.rows[0];
        
        // Mark next alternative as booked
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['booked', nextAlternativeId]
        );
        
        // Update appointment to use next alternative
        await pool.query(
          `UPDATE appointments 
           SET time_slot_id = $1, current_alternative_index = $2, approval_status = 'pending'
           WHERE id = $3`,
          [nextAlternativeId, nextAlternativeIndex, appointment.id]
        );
        
        await pool.query('COMMIT');
        
        // Send email with next alternative
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
          (request.headers.get('origin') || 'http://localhost:3000');
        
        const dentistFullName = nextAltSlot.doktor_neve || nextAltSlot.dentist_email;
        const nextStartTime = new Date(nextAltSlot.start_time);
        
        // Get remaining alternatives data
        let remainingAlternatives: Array<{ id: string; startTime: Date; cim: string | null; teremszam: string | null }> = [];
        const remainingIds = alternativeIds.slice(nextAlternativeIndex + 1);
        if (remainingIds.length > 0) {
          const remainingSlotsResult = await pool.query(
            `SELECT ats.id, ats.start_time, ats.cim, ats.teremszam
             FROM available_time_slots ats
             WHERE ats.id = ANY($1::uuid[])
             ORDER BY ats.start_time ASC`,
            [remainingIds]
          );
          remainingAlternatives = remainingSlotsResult.rows.map((row: any) => ({
            id: row.id,
            startTime: new Date(row.start_time),
            cim: row.cim,
            teremszam: row.teremszam,
          }));
        }
        
        try {
          await sendConditionalAppointmentRequestToPatient(
            appointment.patient_email,
            appointment.patient_name,
            appointment.patient_nem,
            nextStartTime,
            dentistFullName,
            appointment.approval_token,
            baseUrl,
            remainingAlternatives,
            nextAltSlot.cim,
            nextAltSlot.teremszam,
            false // Don't show remaining alternatives to patient
          );
        } catch (emailError) {
          logger.error('Failed to send alternative appointment email:', emailError);
        }
        
        // Return success page with next alternative info
        const formattedDate = nextStartTime.toLocaleString('hu-HU');
        const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
        const displayCim = nextAltSlot.cim || DEFAULT_CIM;
        const displayTerem = nextAltSlot.teremszam ? ` (${nextAltSlot.teremszam}. terem)` : '';
        
        return new NextResponse(`
          <!DOCTYPE html>
          <html lang="hu">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Alternatív időpont</title>
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
              <h1>🔄 Alternatív időpont</h1>
              <p>Az előző időpontot elvetettük.</p>
              <p>Egy alternatív időpontot küldtünk Önnek emailben:</p>
              <p><strong>${formattedDate}</strong><br>${displayCim}${displayTerem}</p>
              <p>Kérjük, ellenőrizze az emailjét és válassza ki az új időpontot.</p>
            </div>
          </body>
          </html>
        `, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } else {
        // No more alternatives, reject the appointment and free all time slots
        await pool.query(
          'UPDATE appointments SET approval_status = $1 WHERE id = $2',
          ['rejected', appointment.id]
        );

        // Free the current time slot
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['available', appointment.time_slot_id]
        );

        // Free all alternative time slots
        const validIds = alternativeIds.filter((id: any) => id && typeof id === 'string');
        if (validIds.length > 0) {
          await pool.query(
            'UPDATE available_time_slots SET status = $1 WHERE id = ANY($2::uuid[])',
            ['available', validIds]
          );
        }

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
              <p>Az összes időpont újra foglalhatóvá vált.</p>
              <p>Ha új időpontot szeretne, kérjük, lépjen kapcsolatba velünk: <a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
            </div>
          </body>
          </html>
        `;

        return new NextResponse(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Hiba történt az időpont elvetésekor');
  }
}

