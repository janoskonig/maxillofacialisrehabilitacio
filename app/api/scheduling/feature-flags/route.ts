import { type NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import {
  getAllSchedulingFeatureFlags,
  invalidateSchedulingFeatureFlagsCache,
  type SchedulingFeatureFlagKey,
} from '@/lib/scheduling-feature-flags';

const VALID_KEYS: SchedulingFeatureFlagKey[] = [
  'overbooking',
  'auto_convert_intents',
  'auto_rebalance',
  'strict_one_hard_next',
];

/**
 * GET /api/scheduling/feature-flags
 * Admin only. Returns current flag values.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });

    const flags = await getAllSchedulingFeatureFlags();
    return NextResponse.json({ flags });
  } catch (error) {
    console.error('Error fetching feature flags:', error);
    return NextResponse.json(
      { error: 'Hiba történt a feature flag lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/scheduling/feature-flags
 * Admin only. Update one or more flags.
 * Body: { overbooking?: boolean, auto_convert_intents?: boolean, ... }
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });

    const body = await request.json();
    const pool = getDbPool();

    for (const key of VALID_KEYS) {
      if (typeof body[key] === 'boolean') {
        await pool.query(
          `INSERT INTO scheduling_feature_flags (key, enabled, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET enabled = $2, updated_at = CURRENT_TIMESTAMP`,
          [key, body[key]]
        );
      }
    }

    invalidateSchedulingFeatureFlagsCache();
    const flags = await getAllSchedulingFeatureFlags();
    return NextResponse.json({ flags });
  } catch (error) {
    console.error('Error updating feature flags:', error);
    return NextResponse.json(
      { error: 'Hiba történt a feature flag módosításakor' },
      { status: 500 }
    );
  }
}
