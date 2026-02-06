import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { markDoctorMessageAsRead } from '@/lib/doctor-communication';
import { getDbPool } from '@/lib/db';
import { emitDoctorMessageRead } from '@/lib/socket-server';

/**
 * PUT /api/doctor-messages/[id]/read - Üzenet olvasottnak jelölése
 */
export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const messageId = params.id;

    if (!messageId) {
      return NextResponse.json(
        { error: 'Üzenet ID kötelező' },
        { status: 400 }
      );
    }

    // Ellenőrizzük a jogosultságot
    const auth = await verifyAuth(request);

    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenet olvasottnak jelöléséhez' },
        { status: 401 }
      );
    }

    // Üzenet olvasottnak jelölése (group chat-eket is támogatja)
    await markDoctorMessageAsRead(messageId, auth.userId);

    // Ha group chat, küldjük a WebSocket eventet
    const pool = getDbPool();
    const messageResult = await pool.query(
      `SELECT group_id FROM doctor_messages WHERE id = $1`,
      [messageId]
    );

    if (messageResult.rows.length > 0 && messageResult.rows[0].group_id) {
      const groupId = messageResult.rows[0].group_id;
      // Lekérjük a felhasználó nevét
      const userResult = await pool.query(
        `SELECT doktor_neve FROM users WHERE id = $1`,
        [auth.userId]
      );
      const userName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : null;
      
      emitDoctorMessageRead(groupId, messageId, auth.userId, userName);
    }

    return NextResponse.json({
      success: true,
      message: 'Üzenet olvasottnak jelölve',
    });
  } catch (error: any) {
    console.error('Hiba az üzenet olvasottnak jelölésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenet olvasottnak jelölésekor' },
      { status: 500 }
    );
  }
}

