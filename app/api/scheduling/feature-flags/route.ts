import { type NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
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

export const GET = roleHandler(['admin'], async (req, { auth }) => {
  const flags = await getAllSchedulingFeatureFlags();
  return NextResponse.json({ flags });
});

export const PATCH = roleHandler(['admin'], async (req, { auth }) => {
  const body = await req.json();
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
});
