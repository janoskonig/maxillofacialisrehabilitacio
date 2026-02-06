import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { sendNewAppointmentRequestToAdmin, sendConditionalAppointmentRequestToPatient } from '@/lib/email';
import { handleApiError } from '@/lib/api-error-handler';

/**
 * Request a new appointment (via email link)
 * This endpoint is no longer available - patients can only approve or reject appointments
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // This endpoint is disabled - patients can only approve or reject appointments
    return new NextResponse(`
      <!DOCTYPE html>
      <html lang="hu">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Opció nem elérhető</title>
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
          a {
            color: #2563eb;
            text-decoration: none;
            font-weight: bold;
          }
          a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✗ Opció nem elérhető</h1>
          <p>Ez az opció már nem elérhető.</p>
          <p>Az időpontot csak elfogadni vagy elutasítani lehet.</p>
          <p>Ha új időpontot szeretne, kérjük, lépjen kapcsolatba velünk emailben:</p>
          <p style="margin: 20px 0;"><a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
        </div>
      </body>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    return handleApiError(error, 'Hiba történt');
  }
}

// Disabled - keeping old code for reference but it's not used anymore
/*
export async function GET_OLD(request: NextRequest) {
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

    // Find appointment by token with alternative slots info
    const appointmentResult = await pool.query(
      `SELECT a.*, p.nev as patient_name, p.taj as patient_taj, p.email as patient_email, p.nem as patient_nem,
              ats.start_time, ats.cim, ats.teremszam,
              u.doktor_neve, u.email as dentist_email
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
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
    
    // Get alternative time slots
    const alternativeIds = appointment.alternative_time_slot_ids || [];
    const currentAlternativeIndex = appointment.current_alternative_index;
    
    // Determine which alternative to show (first one if primary, next one if already showing alternative)
    let nextAlternativeIndex: number | null = null;
    if (currentAlternativeIndex === null) {
      // Currently showing primary, show first alternative
      nextAlternativeIndex = alternativeIds.length > 0 ? 0 : null;
    } else if (currentAlternativeIndex < alternativeIds.length - 1) {
      // Show next alternative
      nextAlternativeIndex = currentAlternativeIndex + 1;
    }
    
    // Check if there's an action parameter (approve alternative or request new)
    const action = request.nextUrl.searchParams.get('action');
    
    if (action === 'approve' && nextAlternativeIndex !== null) {
      // Patient wants to approve the alternative slot
      const nextAlternativeId = alternativeIds[nextAlternativeIndex];
      
      await pool.query('BEGIN');
      
      try {
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
          await pool.query('ROLLBACK');
          return new NextResponse(`
            <!DOCTYPE html>
            <html lang="hu">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Hiba</title>
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
                <h1>✗ Hiba</h1>
                <p>Az alternatív időpont már nem elérhető.</p>
                <p>Kérjük, lépjen kapcsolatba velünk: <a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
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
        
        // Update appointment to use next alternative and approve it
        await pool.query(
          `UPDATE appointments 
           SET time_slot_id = $1, current_alternative_index = $2, approval_status = 'approved'
           WHERE id = $3`,
          [nextAlternativeId, nextAlternativeIndex, appointment.id]
        );
        
        await pool.query('COMMIT');
        
        // Send approval notifications (similar to approve route)
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
          (request.headers.get('origin') || 'http://localhost:3000');
        
        // TODO: Send approval emails here if needed
        
        return new NextResponse(`
          <!DOCTYPE html>
          <html lang="hu">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Időpont elfogadva</title>
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
              h1 { color: #10b981; }
              p { color: #6b7280; line-height: 1.6; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✓ Időpont elfogadva</h1>
              <p>Köszönjük! Az alternatív időpontot sikeresen elfogadtuk.</p>
              <p>Időpont: <strong>${new Date(nextAltSlot.start_time).toLocaleString('hu-HU')}</strong></p>
            </div>
          </body>
          </html>
        `, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
    
    if (action === 'request-new' && nextAlternativeIndex !== null) {
      // Patient wants a new appointment, send next alternative
      const nextAlternativeId = alternativeIds[nextAlternativeIndex];
      
      await pool.query('BEGIN');
      
      try {
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
          // No more alternatives, show email contact
          await pool.query(
            'UPDATE appointments SET approval_status = $1 WHERE id = $2',
            ['rejected', appointment.id]
          );
          await pool.query('COMMIT');
          
          return new NextResponse(`
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
                a {
                  color: #2563eb;
                  text-decoration: none;
                  font-weight: bold;
                }
                a:hover {
                  text-decoration: underline;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>📧 Kapcsolatfelvétel</h1>
                <p>Sajnáljuk, hogy az ajánlott időpontok nem feleltek meg.</p>
                <p>Kérjük, lépjen kapcsolatba velünk emailben:</p>
                <p><a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
                <p>Szívesen segítünk egy megfelelő időpontot találni.</p>
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
        
        // Get remaining alternatives
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
            false // Don't show remaining alternatives
          );
        } catch (emailError) {
          console.error('Failed to send alternative appointment email:', emailError);
        }
        
        return new NextResponse(`
          <!DOCTYPE html>
          <html lang="hu">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Alternatív időpont küldve</title>
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
              <h1>🔄 Alternatív időpont küldve</h1>
              <p>Egy alternatív időpontot küldtünk Önnek emailben.</p>
              <p>Kérjük, ellenőrizze az emailjét és válassza ki az új időpontot.</p>
            </div>
          </body>
          </html>
        `, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
    
    // If no action or no alternative, show the alternative selection page
    if (nextAlternativeIndex !== null) {
      // There's an alternative to show
      const nextAlternativeId = alternativeIds[nextAlternativeIndex];
      
      // Get alternative slot info
      const altSlotResult = await pool.query(
        `SELECT ats.*, u.doktor_neve, u.email as dentist_email
         FROM available_time_slots ats
         JOIN users u ON ats.user_id = u.id
         WHERE ats.id = $1`,
        [nextAlternativeId]
      );
      
      if (altSlotResult.rows.length === 0 || altSlotResult.rows[0].status !== 'available') {
        // Alternative no longer available, show email contact
        return new NextResponse(`
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
              a {
                color: #2563eb;
                text-decoration: none;
                font-weight: bold;
              }
              a:hover {
                text-decoration: underline;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>📧 Kapcsolatfelvétel</h1>
              <p>Sajnáljuk, hogy az ajánlott időpontok nem feleltek meg.</p>
              <p>Kérjük, lépjen kapcsolatba velünk emailben:</p>
              <p><a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
              <p>Szívesen segítünk egy megfelelő időpontot találni.</p>
            </div>
          </body>
          </html>
        `, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      
      const altSlot = altSlotResult.rows[0];
      const altStartTime = new Date(altSlot.start_time);
      const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
      const displayCim = altSlot.cim || DEFAULT_CIM;
      const displayTerem = altSlot.teremszam ? ` (${altSlot.teremszam}. terem)` : '';
      const formattedDate = altStartTime.toLocaleString('hu-HU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      
      const approveUrl = `${request.nextUrl.origin}/api/appointments/request-new?token=${token}&action=approve`;
      const requestNewUrl = `${request.nextUrl.origin}/api/appointments/request-new?token=${token}&action=request-new`;
      
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
            .appointment-info {
              background: #f9fafb;
              padding: 20px;
              border-radius: 6px;
              margin: 20px 0;
            }
            .buttons {
              display: flex;
              gap: 10px;
              justify-content: center;
              margin-top: 30px;
            }
            .btn {
              display: inline-block;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 6px;
              font-weight: bold;
              transition: background-color 0.2s;
            }
            .btn-approve {
              background-color: #10b981;
              color: white;
            }
            .btn-approve:hover {
              background-color: #059669;
            }
            .btn-request {
              background-color: #3b82f6;
              color: white;
            }
            .btn-request:hover {
              background-color: #2563eb;
            }
            .email-contact {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e5e7eb;
            }
            a.email-link {
              color: #2563eb;
              text-decoration: none;
              font-weight: bold;
            }
            a.email-link:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔄 Alternatív időpont</h1>
            <p>Az előző időpontot elvetettük. Egy alternatív időpontot ajánlunk Önnek:</p>
            <div class="appointment-info">
              <p><strong>Időpont:</strong> ${formattedDate}</p>
              <p><strong>Cím:</strong> ${displayCim}${displayTerem}</p>
            </div>
            <div class="buttons">
              <a href="${approveUrl}" class="btn btn-approve">✓ Elfogadom</a>
              <a href="${requestNewUrl}" class="btn btn-request">🔄 Új időpontot kérek</a>
            </div>
            <div class="email-contact">
              <p style="font-size: 14px; color: #6b7280;">
                Ha ez az időpont sem megfelelő, kérjük, lépjen kapcsolatba velünk:<br>
                <a href="mailto:konig.janos@semmelweis.hu" class="email-link">konig.janos@semmelweis.hu</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // No more alternatives, show email contact page
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

      // Return email contact page
      return new NextResponse(`
        <!DOCTYPE html>
        <html lang="hu">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Kapcsolatfelvétel</title>
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
            a {
              color: #2563eb;
              text-decoration: none;
              font-weight: bold;
              font-size: 18px;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📧 Kapcsolatfelvétel</h1>
            <p>Sajnáljuk, hogy az ajánlott időpontok nem feleltek meg.</p>
            <p>Kérjük, lépjen kapcsolatba velünk emailben:</p>
            <p style="margin: 20px 0;"><a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
            <p>Szívesen segítünk egy megfelelő időpontot találni.</p>
          </div>
        </body>
        </html>
      `, {
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
*/

