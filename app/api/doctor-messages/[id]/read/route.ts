import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { markDoctorMessageAsRead } from '@/lib/doctor-communication';
import { getDbPool } from '@/lib/db';

/**
 * PUT /api/doctor-messages/[id]/read - Üzenet olvasottnak jelölése
 */
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

    // Ellenőrizzük, hogy a felhasználó a címzett
    const pool = getDbPool();
    const messageResult = await pool.query(
      `SELECT recipient_id FROM doctor_messages WHERE id = $1`,
      [messageId]
    );

    if (messageResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Üzenet nem található' },
        { status: 404 }
      );
    }

    const message = messageResult.rows[0];

    if (message.recipient_id !== auth.userId) {
      return NextResponse.json(
        { error: 'Csak a saját fogadott üzeneteit jelölheti olvasottnak' },
        { status: 403 }
      );
    }

    // Üzenet olvasottnak jelölése
    await markDoctorMessageAsRead(messageId, auth.userId);

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

