import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json(
      { error: 'Nincs jogosultsága az adatok lekérdezéséhez' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  const result = await pool.query(
    `SELECT
       doctor_id,
       doctor_name,
       doctor_email,
       last_message,
       last_message_sender_type,
       last_message_created_at,
       unread_count
     FROM (
       SELECT
         u.id AS doctor_id,
         u.doktor_neve AS doctor_name,
         u.email AS doctor_email,
         -- last message info
         FIRST_VALUE(m.message) OVER (PARTITION BY u.id ORDER BY m.created_at DESC) AS last_message,
         FIRST_VALUE(m.sender_type) OVER (PARTITION BY u.id ORDER BY m.created_at DESC) AS last_message_sender_type,
         FIRST_VALUE(m.created_at) OVER (PARTITION BY u.id ORDER BY m.created_at DESC) AS last_message_created_at,
         COUNT(*) FILTER (WHERE m.sender_type = 'doctor' AND m.read_at IS NULL) OVER (PARTITION BY u.id) AS unread_count,
         ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY m.created_at DESC) AS rn
       FROM messages m
       JOIN users u ON (
         (m.sender_type = 'patient' AND m.recipient_doctor_id = u.id)
         OR (m.sender_type = 'doctor' AND m.sender_id = u.id)
       )
       WHERE m.patient_id = $1
     ) sub
     WHERE rn = 1
     ORDER BY last_message_created_at DESC`,
    [patientId]
  );

  const conversations = result.rows.map((row: any) => ({
    doctorId: row.doctor_id,
    doctorName: row.doctor_name || row.doctor_email,
    lastMessage: {
      message: row.last_message,
      senderType: row.last_message_sender_type,
      createdAt: new Date(row.last_message_created_at).toISOString(),
    },
    unreadCount: parseInt(row.unread_count, 10) || 0,
  }));

  return NextResponse.json({ success: true, conversations });
});
