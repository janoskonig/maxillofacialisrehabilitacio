import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, apiHandler } from '@/lib/api/route-handler';

type ActivityBody = {
  action: string;
  detail?: string;
};

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth }) => {
  const body = (await req.json().catch(() => ({}))) as Partial<ActivityBody>;
  const action = (body.action || '').trim();
  const detail = (body.detail || '').toString();
  const ipHeader = req.headers.get('x-forwarded-for') || '';
  const ipAddress = ipHeader.split(',')[0]?.trim() || null;

  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  const pool = getDbPool();
  await pool.query(
    `INSERT INTO activity_logs (user_email, action, detail, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [auth.email, action, detail, ipAddress]
  );

  return NextResponse.json({ ok: true });
});

export const GET = apiHandler(async () => {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT 
       COALESCE(user_email, 'unknown') AS user_email,
       MAX(created_at) AS last_seen,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7d,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS last_30d,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS last_90d
     FROM activity_logs
     GROUP BY COALESCE(user_email, 'unknown')
     ORDER BY last_seen DESC NULLS LAST`
  );

  return NextResponse.json({ summary: result.rows });
});
