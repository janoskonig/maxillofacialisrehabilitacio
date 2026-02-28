import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { sendAppointmentBookingNotification, sendAppointmentBookingNotificationToPatient, sendAppointmentBookingNotificationToAdmins } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';
import { createGoogleCalendarEvent } from '@/lib/google-calendar';
import { handleApiError } from '@/lib/api-error-handler';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

/**
 * Approve a pending appointment (via email link)
 * This converts a pending appointment to an approved/booked appointment
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

    // Find appointment by token
    const appointmentResult = await pool.query(
      `SELECT a.*, p.nev as patient_name, p.taj as patient_taj, p.email as patient_email, p.nem as patient_nem,
              ats.start_time, ats.cim, ats.teremszam, ats.user_id as dentist_user_id,
              u.doktor_neve as dentist_name, u.email as dentist_email
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       JOIN users u ON a.dentist_email = u.email
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

    // Check if time slot is still valid (can only approve before appointment time)
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
            <p>Ez az időpont már elmúlt, nem lehet elfogadni.</p>
            <p>Ha kérdése van, kérjük, lépjen kapcsolatba velünk: <a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
          </div>
        </body>
        </html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Update appointment status to approved and set approved_at timestamp
      await pool.query(
        'UPDATE appointments SET approval_status = $1, approved_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['approved', appointment.id]
      );

      // Time slot is already marked as booked, so no need to update it

      // Free all alternative time slots that were not chosen
      // When patient approves an appointment, all other alternatives should be freed
      const alternativeIdsRaw = appointment.alternative_time_slot_ids;
      const alternativeIds = Array.isArray(alternativeIdsRaw) 
        ? alternativeIdsRaw 
        : (alternativeIdsRaw ? [alternativeIdsRaw] : []);
      
      if (alternativeIds.length > 0) {
        // Filter out any null/undefined values and ensure they're valid UUIDs
        const validIds = alternativeIds.filter((id: any) => id && typeof id === 'string');
        if (validIds.length > 0) {
          // Free all alternative time slots
          await pool.query(
            'UPDATE available_time_slots SET status = $1 WHERE id = ANY($2::uuid[])',
            ['available', validIds]
          );
        }
      }

      await pool.query('COMMIT');

      // Send notifications and create Google Calendar event
      const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
      const appointmentCim = appointment.cim || DEFAULT_CIM;
      const appointmentTeremszam = appointment.teremszam || null;

      const updatedStartTime = new Date(appointment.start_time);
      const endTime = new Date(updatedStartTime);
      endTime.setMinutes(endTime.getMinutes() + 30); // 30 minutes duration

      // Get admin emails and dentist full name
      const [adminResult] = await Promise.all([
        pool.query('SELECT email FROM users WHERE role = $1 AND active = true', ['admin']),
      ]);
      
      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
      const adminEmail = adminEmails.length > 0 ? adminEmails[0] : '';
      const dentistFullName = appointment.dentist_name || appointment.dentist_email;

      // Generate ICS file
      const icsFileData = {
        patientName: appointment.patient_name,
        patientTaj: appointment.patient_taj,
        startTime: updatedStartTime,
        surgeonName: appointment.created_by,
        dentistName: appointment.dentist_email,
      };
      const icsFile = await generateIcsFile(icsFileData);

      // Send notifications
      try {
        await Promise.all([
          // Email to dentist
          sendAppointmentBookingNotification(
            appointment.dentist_email,
            appointment.patient_name,
            appointment.patient_taj,
            updatedStartTime,
            appointment.created_by,
            icsFile,
            appointmentCim,
            appointmentTeremszam
          ),
          // Google Calendar event
          (async () => {
            try {
              const userCalendarResult = await pool.query(
                `SELECT google_calendar_enabled, google_calendar_target_calendar_id 
                 FROM users 
                 WHERE id = $1`,
                [appointment.dentist_user_id]
              );
              if (userCalendarResult.rows[0]?.google_calendar_enabled !== true) {
                logger.info('[Appointment Approval] Slot owner has Google Calendar disabled, skipping sync');
                return;
              }
              const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';
              
              const newEventId = await createGoogleCalendarEvent(
                appointment.dentist_user_id,
                {
                  summary: `Betegfogadás - ${appointment.patient_name || 'Név nélküli beteg'}`,
                  description: `Beteg: ${appointment.patient_name || 'Név nélküli'}\nTAJ: ${appointment.patient_taj || 'Nincs megadva'}\nBeutaló orvos: ${appointment.created_by}`,
                  startTime: updatedStartTime,
                  endTime: endTime,
                  location: 'Maxillofaciális Rehabilitáció',
                  calendarId: targetCalendarId,
                }
              );

              if (newEventId) {
                await pool.query(
                  'UPDATE appointments SET google_calendar_event_id = $1 WHERE id = $2',
                  [newEventId, appointment.id]
                );
              }
            } catch (error) {
              logger.error('[Appointment Approval] Failed to create Google Calendar event:', error);
            }
          })(),
        ]);

        // Email to patient
        if (appointment.patient_email && appointment.patient_email.trim() !== '') {
          await sendAppointmentBookingNotificationToPatient(
            appointment.patient_email,
            appointment.patient_name,
            appointment.patient_nem,
            updatedStartTime,
            dentistFullName,
            appointment.dentist_email,
            icsFile,
            appointmentCim,
            appointmentTeremszam,
            adminEmail
          );
        }

        // Push notification to patient
        try {
          if (appointment.patient_email) {
            const patientUserResult = await pool.query(
              'SELECT id FROM users WHERE email = $1 AND active = true',
              [appointment.patient_email]
            );
            
            if (patientUserResult.rows.length > 0) {
              const patientUserId = patientUserResult.rows[0].id;
              const formattedDate = format(updatedStartTime, "yyyy. MM. dd. HH:mm", { locale: hu });
              await sendPushNotification(patientUserId, {
                title: "Időpont elfogadva",
                body: `Időpont: ${formattedDate}`,
                icon: "/icon-192x192.png",
                tag: `appointment-approved-${appointment.id}`,
                data: {
                  url: `/patient-portal/appointments`,
                  type: "appointment",
                  id: appointment.id,
                },
              });
            }
          }
        } catch (pushError) {
          logger.error('Failed to send push notification to patient:', pushError);
        }

        // Email to admins
        if (adminEmails.length > 0) {
          await sendAppointmentBookingNotificationToAdmins(
            adminEmails,
            appointment.patient_name,
            appointment.patient_taj,
            updatedStartTime,
            appointment.created_by,
            appointment.dentist_email,
            icsFile,
            appointmentCim,
            appointmentTeremszam
          );
        }
      } catch (emailError) {
        logger.error('Failed to send appointment approval notifications:', emailError);
        // Don't fail the request if email fails
      }

      // Return success page HTML
      const html = `
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
            <p>Köszönjük! Az időpontfoglalását sikeresen elfogadtuk.</p>
            <p>Időpont: <strong>${updatedStartTime.toLocaleString('hu-HU')}</strong></p>
            <p>Részletes információkat emailben küldtünk.</p>
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
    return handleApiError(error, 'Hiba történt az időpont elfogadásakor');
  }
}

