import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { DoctorMessage } from '@/lib/doctor-communication';
import { logger } from '@/lib/logger';

/**
 * GET /api/doctor-messages/recent - Legutóbbi orvos-orvos üzenetek lekérése
 * Query params:
 * - limit: hány üzenetet kérjünk le (alapértelmezett: 5)
 */
export const dynamic = 'force-dynamic';

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

    // Legutóbbi üzenetek (küldött vagy fogadott) - támogatja a group chat-eket is
    const query = `
      SELECT 
        dm.id,
        dm.sender_id,
        dm.recipient_id,
        dm.group_id,
        dm.sender_email,
        dm.sender_name,
        dm.subject,
        dm.message,
        dm.read_at,
        dm.created_at,
        CASE 
          WHEN dm.group_id IS NOT NULL THEN dmg.name
          WHEN dm.sender_id = $1 THEN u_recipient.doktor_neve
          ELSE u_sender.doktor_neve
        END as other_doctor_name,
        CASE 
          WHEN dm.group_id IS NOT NULL THEN NULL
          WHEN dm.sender_id = $1 THEN dm.recipient_id
          ELSE dm.sender_id
        END as other_doctor_id,
        dm.group_id as group_id,
        (SELECT COUNT(*) FROM doctor_message_group_participants WHERE group_id = dm.group_id) as group_participant_count
      FROM doctor_messages dm
      LEFT JOIN users u_sender ON u_sender.id = dm.sender_id
      LEFT JOIN users u_recipient ON u_recipient.id = dm.recipient_id
      LEFT JOIN doctor_message_groups dmg ON dmg.id = dm.group_id
      WHERE dm.sender_id = $1 
         OR dm.recipient_id = $1
         OR dm.group_id IN (SELECT group_id FROM doctor_message_group_participants WHERE user_id = $1)
      ORDER BY dm.created_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [auth.userId, limit]);

    // Lekérjük az olvasókat group chat üzenetekhez
    const groupMessageIds = result.rows
      .filter((row: any) => row.group_id)
      .map((row: any) => row.id);
    const readByMap = new Map<string, Array<{ userId: string; userName: string | null; readAt: Date }>>();
    
    if (groupMessageIds.length > 0) {
      const readsResult = await pool.query(
        `SELECT dmr.message_id, dmr.user_id, dmr.read_at, u.doktor_neve
         FROM doctor_message_reads dmr
         LEFT JOIN users u ON u.id = dmr.user_id
         WHERE dmr.message_id = ANY($1::uuid[])
         ORDER BY dmr.read_at ASC`,
        [groupMessageIds]
      );

      for (const readRow of readsResult.rows) {
        if (!readByMap.has(readRow.message_id)) {
          readByMap.set(readRow.message_id, []);
        }
        readByMap.get(readRow.message_id)!.push({
          userId: readRow.user_id,
          userName: readRow.doktor_neve || null,
          readAt: new Date(readRow.read_at),
        });
      }
    }

    const messages = result.rows.map((row: any) => ({
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      groupId: row.group_id || null,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      subject: row.subject,
      message: row.message,
      readAt: row.read_at ? new Date(row.read_at) : null,
      createdAt: new Date(row.created_at),
      otherDoctorId: row.other_doctor_id,
      otherDoctorName: row.group_id 
        ? (row.other_doctor_name || `Csoportos beszélgetés (${row.group_participant_count || 0} résztvevő)`)
        : (row.other_doctor_name || 'Ismeretlen orvos'),
      groupName: row.group_id ? (row.other_doctor_name || `Csoportos beszélgetés`) : null,
      groupParticipantCount: row.group_id ? (row.group_participant_count || 0) : null,
      readBy: row.group_id ? (readByMap.get(row.id) || []) : undefined,
    }));

    // Olvasatlan üzenetek száma (egyéni és csoportos beszélgetések)
    const unreadResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM doctor_messages dm
       WHERE (
         (dm.recipient_id = $1 AND dm.read_at IS NULL)
         OR 
         (dm.group_id IS NOT NULL 
          AND dm.group_id IN (SELECT group_id FROM doctor_message_group_participants WHERE user_id = $1)
          AND dm.sender_id != $1
          AND dm.read_at IS NULL)
       )`,
      [auth.userId]
    );

    const unreadCount = parseInt(unreadResult.rows[0].count, 10);

    return NextResponse.json({
      success: true,
      messages,
      unreadCount,
    });
  } catch (error: any) {
    logger.error('Hiba a legutóbbi üzenetek lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenetek lekérésekor' },
      { status: 500 }
    );
  }
}

