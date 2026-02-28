import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getUnreadDoctorMessageCount } from '@/lib/doctor-communication';
import { logger } from '@/lib/logger';

/**
 * GET /api/doctor-messages/unread-count - Olvasatlan üzenetek száma
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Ellenőrizzük a jogosultságot
    const auth = await verifyAuth(request);

    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az olvasatlan üzenetek számának lekérdezéséhez' },
        { status: 401 }
      );
    }

    // Olvasatlan üzenetek száma
    const count = await getUnreadDoctorMessageCount(auth.userId);

    return NextResponse.json({
      success: true,
      count,
    });
  } catch (error: any) {
    logger.error('Hiba az olvasatlan üzenetek számának lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az olvasatlan üzenetek számának lekérdezésekor' },
      { status: 500 }
    );
  }
}

