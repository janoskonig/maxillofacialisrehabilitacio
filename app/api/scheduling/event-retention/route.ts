import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  return handleRetention(req);
});

export const POST = apiHandler(async (req, { correlationId }) => {
  return handleRetention(req);
});

async function handleRetention(request: { headers: { get(name: string): string | null }; nextUrl: { searchParams: URLSearchParams } }) {
  const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
  const expectedKey = process.env.EVENT_RETENTION_API_KEY;
  const retentionDays = parseInt(request.nextUrl.searchParams.get('retentionDays') || '1095', 10);

  if (expectedKey && apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getDbPool();
  const result = await pool.query('SELECT * FROM drop_old_event_partitions($1)', [retentionDays]);
  const dropped = result.rows;

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    retentionDays,
    droppedPartitions: dropped.length,
    dropped: dropped.map((r: { dropped_table: string; partition_month: string }) => ({
      table: r.dropped_table,
      month: r.partition_month,
    })),
  });
}
