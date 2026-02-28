import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { handleApiError } from '@/lib/api-error-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      logger.error('[Push Subscribe] Unauthorized request');
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { endpoint, keys } = body;

    logger.info('[Push Subscribe] Received subscription request for user:', auth.userId);

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      logger.error('[Push Subscribe] Missing subscription data:', { endpoint: !!endpoint, hasKeys: !!keys, hasP256dh: !!keys?.p256dh, hasAuth: !!keys?.auth });
      return NextResponse.json(
        { error: 'Hiányzó subscription adatok' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    const userAgent = request.headers.get('user-agent') || null;

    // Ellenőrizzük, hogy van-e már ilyen subscription
    const existingResult = await pool.query(
      'SELECT id FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [auth.userId, endpoint]
    );

    if (existingResult.rows.length > 0) {
      // Frissítjük a meglévő subscription-t
      logger.info('[Push Subscribe] Updating existing subscription for user:', auth.userId);
      await pool.query(
        `UPDATE push_subscriptions 
         SET p256dh = $1, auth = $2, user_agent = $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4 AND endpoint = $5`,
        [keys.p256dh, keys.auth, userAgent, auth.userId, endpoint]
      );
    } else {
      // Új subscription létrehozása
      logger.info('[Push Subscribe] Creating new subscription for user:', auth.userId);
      await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [auth.userId, endpoint, keys.p256dh, keys.auth, userAgent]
      );
    }

    logger.info('[Push Subscribe] Subscription saved successfully for user:', auth.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[Push Subscribe] Error:', error);
    return handleApiError(error, 'Hiba történt a push subscription regisztrálásakor');
  }
}
