import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { Message } from '@/lib/communication';

/**
 * GET /api/messages/conversations - Beteg beszélgetések listája az orvos számára
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Összes egyedi beteg, akivel van üzenet
    let query = `
      SELECT DISTINCT m.patient_id
      FROM messages m
      INNER JOIN patients p ON p.id = m.patient_id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Ha nem admin, csak a saját betegeinek üzeneteit
    if (auth.role !== 'admin') {
      query += ` AND (
        p.kezeleoorvos = $${paramIndex} OR 
        p.kezeleoorvos = (SELECT doktor_neve FROM users WHERE id = $${paramIndex + 1})
      )`;
      params.push(auth.email, auth.userId);
      paramIndex += 2;
    }

    const result = await pool.query(query, params);
    const conversations = [];

    for (const row of result.rows) {
      const patientId = row.patient_id;

      // Beteg adatok
      const patientResult = await pool.query(
        `SELECT id, nev, taj FROM patients WHERE id = $1`,
        [patientId]
      );

      if (patientResult.rows.length === 0) continue;

      const patient = patientResult.rows[0];

      // Utolsó üzenet
      const lastMessageResult = await pool.query(
        `SELECT id, patient_id, sender_type, sender_id, sender_email, subject, message, read_at, created_at
         FROM messages
         WHERE patient_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [patientId]
      );

      let lastMessage: Message | null = null;
      if (lastMessageResult.rows.length > 0) {
        const msgRow = lastMessageResult.rows[0];
        lastMessage = {
          id: msgRow.id,
          patientId: msgRow.patient_id,
          senderType: msgRow.sender_type,
          senderId: msgRow.sender_id,
          senderEmail: msgRow.sender_email,
          subject: msgRow.subject,
          message: msgRow.message,
          readAt: msgRow.read_at ? new Date(msgRow.read_at) : null,
          createdAt: new Date(msgRow.created_at),
        };
      }

      // Olvasatlan üzenetek száma (csak betegtől érkező olvasatlan üzenetek)
      const unreadResult = await pool.query(
        `SELECT COUNT(*) as count
         FROM messages
         WHERE patient_id = $1 AND sender_type = 'patient' AND read_at IS NULL`,
        [patientId]
      );

      conversations.push({
        patientId: patient.id,
        patientName: patient.nev || 'Név nélküli beteg',
        patientTaj: patient.taj,
        lastMessage,
        unreadCount: parseInt(unreadResult.rows[0].count, 10),
      });
    }

    // Rendezés: olvasatlan üzenetek száma szerint, majd utolsó üzenet dátuma szerint
    conversations.sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) {
        return b.unreadCount - a.unreadCount; // Több olvasatlan = előrébb
      }
      if (a.lastMessage && b.lastMessage) {
        return b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime();
      }
      if (a.lastMessage) return -1;
      if (b.lastMessage) return 1;
      return 0;
    });

    return NextResponse.json({
      success: true,
      conversations,
    });
  } catch (error: any) {
    console.error('Hiba a beszélgetések lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a beszélgetések lekérésekor' },
      { status: 500 }
    );
  }
}

