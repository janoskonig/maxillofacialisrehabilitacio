import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { DoctorMessage } from '@/lib/doctor-communication';

/**
 * GET /api/doctor-messages/recent - Legutóbbi orvos-orvos üzenetek lekérése
 * Query params:
 * - limit: hány üzenetet kérjünk le (alapértelmezett: 5)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 5;

    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Legutóbbi üzenetek (küldött vagy fogadott)
    const query = `
      SELECT 
        dm.id,
        dm.sender_id,
        dm.recipient_id,
        dm.sender_email,
        dm.sender_name,
        dm.subject,
        dm.message,
        dm.read_at,
        dm.created_at,
        CASE 
          WHEN dm.sender_id = $1 THEN u_recipient.doktor_neve
          ELSE u_sender.doktor_neve
        END as other_doctor_name,
        CASE 
          WHEN dm.sender_id = $1 THEN dm.recipient_id
          ELSE dm.sender_id
        END as other_doctor_id
      FROM doctor_messages dm
      LEFT JOIN users u_sender ON u_sender.id = dm.sender_id
      LEFT JOIN users u_recipient ON u_recipient.id = dm.recipient_id
      WHERE dm.sender_id = $1 OR dm.recipient_id = $1
      ORDER BY dm.created_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [auth.userId, limit]);

    const messages = result.rows.map((row: any) => ({
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      subject: row.subject,
      message: row.message,
      readAt: row.read_at ? new Date(row.read_at) : null,
      createdAt: new Date(row.created_at),
      otherDoctorId: row.other_doctor_id,
      otherDoctorName: row.other_doctor_name || 'Ismeretlen orvos',
    }));

    // Olvasatlan üzenetek száma
    const unreadResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM doctor_messages
       WHERE recipient_id = $1 AND read_at IS NULL`,
      [auth.userId]
    );

    const unreadCount = parseInt(unreadResult.rows[0].count, 10);

    return NextResponse.json({
      success: true,
      messages,
      unreadCount,
    });
  } catch (error: any) {
    console.error('Hiba a legutóbbi üzenetek lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenetek lekérésekor' },
      { status: 500 }
    );
  }
}

