import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';

/**
 * GET /api/messages/all - Összes üzenet lekérése az orvos számára (minden betegtől)
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;

    // Csak orvosok kérhetik le
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Ha admin, minden üzenetet lát
    // Ha nem admin, csak azoknak a betegeknek az üzeneteit, akikhez hozzáfér
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

    // Csak a betegtől érkező üzeneteket mutatjuk (patient -> doctor)
    query += ` WHERE m.sender_type = 'patient'`;

    // Ha nem admin, csak a saját betegeinek üzeneteit ÉS csak az ő neki küldött üzeneteket
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
    // Admin esetén minden üzenetet lát (nem szűrünk recipient_doctor_id alapján)

    // Olvasatlan szűrés
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
  } catch (error: any) {
    console.error('Hiba az üzenetek lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenetek lekérésekor' },
      { status: 500 }
    );
  }
}

