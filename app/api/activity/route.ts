import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

type ActivityBody = {
  action: string;
  detail?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<ActivityBody>;
    const action = (body.action || '').trim();
    const detail = (body.detail || '').toString();
    const userEmail = request.headers.get('x-user-email') || null;
    const ipHeader = request.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    const pool = getDbPool();
    await pool.query(
      `INSERT INTO activity_logs (user_email, action, detail, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [userEmail, action, detail, ipAddress]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Failed to write activity log:', err);
    return NextResponse.json({ error: 'Failed to write activity log' }, { status: 500 });
  }
}

export async function GET() {
  try {
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
  } catch (err) {
    console.error('Failed to read activity summary:', err);
    return NextResponse.json({ error: 'Failed to read activity summary' }, { status: 500 });
  }
}


