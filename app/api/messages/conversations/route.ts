import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { Message } from '@/lib/communication';

/**
 * GET /api/messages/conversations - Beteg beszélgetések listája az orvos számára
 */
export const dynamic = 'force-dynamic';

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

      // Utolsó üzenet (csak az adott orvosnak küldött üzeneteket figyelembe véve)
      let lastMessageQuery = `
        SELECT m.id, m.patient_id, m.sender_type, m.sender_id, m.sender_email, m.subject, m.message, m.read_at, m.created_at, m.recipient_doctor_id
        FROM messages m
        INNER JOIN patients p ON p.id = m.patient_id
        WHERE m.patient_id = $1
      `;
      const lastMessageParams: any[] = [patientId];
      
      // Ha nem admin, csak az adott orvosnak küldött üzeneteket mutatjuk
      if (auth.role !== 'admin') {
        // Ellenőrizzük, hogy az orvos a kezelőorvos-e
        const patientData = await pool.query(
          `SELECT kezeleoorvos FROM patients WHERE id = $1`,
          [patientId]
        );
        const kezeleoorvos = patientData.rows.length > 0 ? patientData.rows[0].kezeleoorvos : null;
        
        let isTreatingDoctor = false;
        if (kezeleoorvos) {
          const doctorCheck = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND (email = $2 OR doktor_neve = $2)`,
            [auth.userId, kezeleoorvos]
          );
          isTreatingDoctor = doctorCheck.rows.length > 0;
        }
        
        if (isTreatingDoctor) {
          // Ha a kezelőorvos, akkor látja a recipient_doctor_id IS NULL üzeneteket is
          lastMessageQuery += ` AND (
            (m.sender_type = 'patient' AND (m.recipient_doctor_id = $2 OR m.recipient_doctor_id IS NULL))
            OR (m.sender_type = 'doctor' AND m.sender_id = $2)
          )`;
        } else {
          // Ha nem a kezelőorvos, akkor csak az explicit neki küldött üzeneteket látja
          lastMessageQuery += ` AND (
            (m.sender_type = 'patient' AND m.recipient_doctor_id = $2)
            OR (m.sender_type = 'doctor' AND m.sender_id = $2)
          )`;
        }
        lastMessageParams.push(auth.userId);
      }
      // Admin esetén minden üzenetet lát (nem szűrünk)
      
      lastMessageQuery += ` ORDER BY m.created_at DESC LIMIT 1`;
      
      const lastMessageResult = await pool.query(lastMessageQuery, lastMessageParams);

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

      // Olvasatlan üzenetek száma (csak betegtől érkező olvasatlan üzenetek, amelyek az adott orvosnak küldve)
      let unreadQuery = `
        SELECT COUNT(*) as count
        FROM messages m
        WHERE m.patient_id = $1 AND m.sender_type = 'patient' AND m.read_at IS NULL
      `;
      const unreadParams: any[] = [patientId];
      
      // Ha nem admin, csak az adott orvosnak küldött üzeneteket számoljuk
      if (auth.role !== 'admin') {
        // Ellenőrizzük, hogy az orvos a kezelőorvos-e
        const patientData = await pool.query(
          `SELECT kezeleoorvos FROM patients WHERE id = $1`,
          [patientId]
        );
        const kezeleoorvos = patientData.rows.length > 0 ? patientData.rows[0].kezeleoorvos : null;
        
        let isTreatingDoctor = false;
        if (kezeleoorvos) {
          const doctorCheck = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND (email = $2 OR doktor_neve = $2)`,
            [auth.userId, kezeleoorvos]
          );
          isTreatingDoctor = doctorCheck.rows.length > 0;
        }
        
        if (isTreatingDoctor) {
          // Ha a kezelőorvos, akkor számoljuk a recipient_doctor_id IS NULL üzeneteket is
          unreadQuery += ` AND (m.recipient_doctor_id = $2 OR m.recipient_doctor_id IS NULL)`;
        } else {
          // Ha nem a kezelőorvos, akkor csak az explicit neki küldött üzeneteket számoljuk
          unreadQuery += ` AND m.recipient_doctor_id = $2`;
        }
        unreadParams.push(auth.userId);
      }
      // Admin esetén minden olvasatlan üzenetet számolunk (nem szűrünk)
      
      const unreadResult = await pool.query(unreadQuery, unreadParams);

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

