import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { handleApiError } from '@/lib/api-error-handler';

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { error: 'Hiányzó endpoint' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Subscription törlése
    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [auth.userId, endpoint]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Hiba történt a push subscription törlésekor');
  }
}
