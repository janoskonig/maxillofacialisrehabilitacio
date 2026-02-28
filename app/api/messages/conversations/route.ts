import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();

  const isAdmin = auth.role === 'admin';

  let doctorName: string | null = null;
  if (!isAdmin) {
    const userRow = await pool.query(
      `SELECT doktor_neve FROM users WHERE id = $1`,
      [auth.userId]
    );
    doctorName = userRow.rows[0]?.doktor_neve ?? null;
  }

  // Single query: get all patient_ids that have messages visible to this user
  let patientIdsQuery: string;
  const patientIdsParams: any[] = [];

  if (isAdmin) {
    patientIdsQuery = `SELECT DISTINCT m.patient_id FROM messages m`;
  } else {
    patientIdsQuery = `
      SELECT DISTINCT m.patient_id
      FROM messages m
      JOIN patients p ON p.id = m.patient_id
      WHERE (
        p.kezeleoorvos = $1 OR p.kezeleoorvos = $2
      )`;
    patientIdsParams.push(auth.email, doctorName);
  }

  const patientIdsResult = await pool.query(patientIdsQuery, patientIdsParams);
  const patientIds = patientIdsResult.rows.map((r: any) => r.patient_id);

  if (patientIds.length === 0) {
    return NextResponse.json({ success: true, conversations: [] });
  }

  // Batch: get patient info, last messages, and unread counts in 3 parallel queries
  const [patientsResult, lastMessagesResult, unreadResult] = await Promise.all([
    pool.query(
      `SELECT id, nev, taj FROM patients WHERE id = ANY($1)`,
      [patientIds]
    ),
    pool.query(
      `SELECT DISTINCT ON (m.patient_id)
         m.patient_id, m.id, m.sender_type, m.sender_id, m.sender_email,
         m.subject, m.message, m.read_at, m.created_at
       FROM messages m
       WHERE m.patient_id = ANY($1)
       ${!isAdmin ? `AND (
         (m.sender_type = 'patient' AND (m.recipient_doctor_id = $2 OR m.recipient_doctor_id IS NULL))
         OR (m.sender_type = 'doctor' AND m.sender_id = $2)
       )` : ''}
       ORDER BY m.patient_id, m.created_at DESC`,
      isAdmin ? [patientIds] : [patientIds, auth.userId]
    ),
    pool.query(
      `SELECT m.patient_id, COUNT(*)::int as count
       FROM messages m
       WHERE m.patient_id = ANY($1) AND m.sender_type = 'patient' AND m.read_at IS NULL
       ${!isAdmin ? `AND (m.recipient_doctor_id = $2 OR m.recipient_doctor_id IS NULL)` : ''}
       GROUP BY m.patient_id`,
      isAdmin ? [patientIds] : [patientIds, auth.userId]
    ),
  ]);

  const patientMap = new Map(
    patientsResult.rows.map((r: any) => [r.id, r])
  );
  const lastMessageMap = new Map(
    lastMessagesResult.rows.map((r: any) => [r.patient_id, r])
  );
  const unreadMap = new Map(
    unreadResult.rows.map((r: any) => [r.patient_id, r.count as number])
  );

  const conversations = patientIds
    .map((pid: string) => {
      const patient = patientMap.get(pid);
      if (!patient) return null;

      const msgRow = lastMessageMap.get(pid);
      const lastMessage = msgRow
        ? {
            id: msgRow.id,
            patientId: msgRow.patient_id,
            senderType: msgRow.sender_type,
            senderId: msgRow.sender_id,
            senderEmail: msgRow.sender_email,
            subject: msgRow.subject,
            message: msgRow.message,
            readAt: msgRow.read_at ? new Date(msgRow.read_at).toISOString() : null,
            createdAt: new Date(msgRow.created_at).toISOString(),
          }
        : null;

      return {
        patientId: patient.id,
        patientName: patient.nev || 'Név nélküli beteg',
        patientTaj: patient.taj,
        lastMessage,
        unreadCount: unreadMap.get(pid) ?? 0,
      };
    })
    .filter(Boolean);

  conversations.sort((a: any, b: any) => {
    if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
    if (a.lastMessage && b.lastMessage) {
      return new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime();
    }
    if (a.lastMessage) return -1;
    if (b.lastMessage) return 1;
    return 0;
  });

  return NextResponse.json({ success: true, conversations });
});
