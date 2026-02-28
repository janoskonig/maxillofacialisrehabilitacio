import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const searchParams = req.nextUrl.searchParams;
  const unreadOnly = searchParams.get('unreadOnly') === 'true';
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;

  const pool = getDbPool();

  let query = `
    SELECT 
      m.id,
      m.patient_id,
      m.sender_type,
      m.sender_id,
      m.sender_email,
      m.subject,
      m.message,
      m.read_at,
      m.created_at,
      p.nev as patient_name,
      p.taj as patient_taj
    FROM messages m
    INNER JOIN patients p ON p.id = m.patient_id
  `;

  const params: any[] = [];
  let paramIndex = 1;

  query += ` WHERE m.sender_type = 'patient'`;

  if (auth.role !== 'admin') {
    query += ` AND (
      p.kezeleoorvos = $${paramIndex} OR 
      p.kezeleoorvos = (SELECT doktor_neve FROM users WHERE id = $${paramIndex + 1})
    ) AND (
      m.recipient_doctor_id = $${paramIndex + 1} 
      OR (m.recipient_doctor_id IS NULL AND (
        p.kezeleoorvos = $${paramIndex} OR 
        p.kezeleoorvos = (SELECT doktor_neve FROM users WHERE id = $${paramIndex + 1})
      ))
    )`;
    params.push(auth.email, auth.userId);
    paramIndex += 2;
  }

  if (unreadOnly) {
    query += ` AND m.read_at IS NULL`;
  }

  query += ` ORDER BY m.created_at DESC`;

  if (limit) {
    query += ` LIMIT $${paramIndex}`;
    params.push(limit);
  }

  const result = await pool.query(query, params);

  const messages = result.rows.map((row: any) => ({
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    patientTaj: row.patient_taj,
    senderType: row.sender_type,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    subject: row.subject,
    message: row.message,
    readAt: row.read_at ? new Date(row.read_at) : null,
    createdAt: new Date(row.created_at),
  }));

  return NextResponse.json({
    success: true,
    messages,
  });
});
