import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { sendPushNotification } from '@/lib/push-notifications';
import { sendAppointmentReminderEmail } from '@/lib/email';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');
  const expectedApiKey = process.env.APPOINTMENT_REMINDER_API_KEY;

  if (expectedApiKey && apiKey !== expectedApiKey) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  const now = new Date();
  const reminderStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const reminderEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const appointmentsResult = await pool.query(
    `SELECT 
      a.id,
      a.patient_id,
      ats.start_time,
      ats.cim,
      ats.teremszam,
      p.nev as patient_name,
      p.email as patient_email,
      p.nem as patient_nem,
      u.email as dentist_email,
      u.doktor_neve as dentist_name,
      u.id as dentist_user_id
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    JOIN patients p ON a.patient_id = p.id
    LEFT JOIN users u ON a.dentist_email = u.email
    WHERE ats.start_time >= $1 
      AND ats.start_time <= $2
      AND a.appointment_status IS NULL
      AND a.approval_status != 'rejected'
    ORDER BY ats.start_time`,
    [reminderStart, reminderEnd]
  );

  const appointments = appointmentsResult.rows;
  let successCount = 0;
  let errorCount = 0;

  for (const appointment of appointments) {
    try {
      const appointmentTime = new Date(appointment.start_time);
      const formattedDate = format(appointmentTime, "yyyy. MM. dd. HH:mm", { locale: hu });

      if (appointment.patient_email) {
        try {
          const patientUserResult = await pool.query(
            'SELECT id FROM users WHERE email = $1 AND active = true',
            [appointment.patient_email]
          );

          if (patientUserResult.rows.length > 0) {
            const patientUserId = patientUserResult.rows[0].id;
            await sendPushNotification(patientUserId, {
              title: "Időpont emlékeztető",
              body: `Időpont holnap: ${formattedDate}`,
              icon: "/icon-192x192.png",
              tag: `reminder-${appointment.id}`,
              data: {
                url: `/patient-portal/appointments`,
                type: "reminder",
                id: appointment.id,
              },
              requireInteraction: true,
            });
          }
        } catch (pushError) {
          logger.error(`Failed to send push reminder to patient ${appointment.patient_email}:`, pushError);
        }

        try {
          await sendAppointmentReminderEmail(
            appointment.patient_email,
            appointment.patient_name,
            appointment.patient_nem,
            appointmentTime,
            appointment.dentist_name || appointment.dentist_email,
            appointment.cim || DEFAULT_CIM,
            appointment.teremszam
          );
        } catch (emailError) {
          logger.error(`Failed to send email reminder to patient ${appointment.patient_email}:`, emailError);
        }
      }

      if (appointment.dentist_user_id) {
        try {
          await sendPushNotification(appointment.dentist_user_id, {
            title: "Időpont emlékeztető",
            body: `${appointment.patient_name || 'Beteg'} - ${formattedDate}`,
            icon: "/icon-192x192.png",
            tag: `reminder-dentist-${appointment.id}`,
            data: {
              url: `/calendar`,
              type: "reminder",
              id: appointment.id,
            },
          });
        } catch (pushError) {
          logger.error(`Failed to send push reminder to dentist ${appointment.dentist_user_id}:`, pushError);
        }
      }

      successCount++;
    } catch (error) {
      logger.error(`Error processing reminder for appointment ${appointment.id}:`, error);
      errorCount++;
    }
  }

  return NextResponse.json({
    success: true,
    processed: appointments.length,
    successCount,
    errorCount,
    message: `Emlékeztetők feldolgozva: ${successCount} sikeres, ${errorCount} hiba`,
  });
});
