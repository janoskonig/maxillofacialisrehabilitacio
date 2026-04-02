import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (_req, { auth }) => {
  const institutionId = await getUserInstitution(auth);
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT
       s.id,
       s.title,
       s.scheduled_at as "scheduledAt",
       s.status,
       COUNT(i.id)::int as "itemCount",
       COUNT(*) FILTER (WHERE i.discussed = true)::int as "discussedCount",
       COUNT(*) FILTER (WHERE i.discussed = false)::int as "openCount"
     FROM consilium_sessions s
     LEFT JOIN consilium_session_items i ON i.session_id = s.id
     WHERE btrim(coalesce(s.institution_id, '')) = btrim(coalesce($1::text, ''))
     GROUP BY s.id
     ORDER BY s.scheduled_at DESC`,
    [institutionId],
  );

  return NextResponse.json({ sessions: result.rows });
});

