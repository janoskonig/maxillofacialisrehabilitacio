import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * POST/GET /api/scheduling/event-retention — drop event log partitions older than 3 years (cron)
 * Protects with API key when EVENT_RETENTION_API_KEY is set.
 */
export async function GET(request: NextRequest) {
  return handleRetention(request);
}

export async function POST(request: NextRequest) {
  return handleRetention(request);
}

async function handleRetention(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const expectedKey = process.env.EVENT_RETENTION_API_KEY;
    const retentionDays = parseInt(request.nextUrl.searchParams.get('retentionDays') || '1095', 10); // 3 years default

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
  } catch (error) {
    console.error('Event retention error:', error);
    return NextResponse.json(
      {
        error: 'Hiba történt az eseménynapló megőrzési szabály alkalmazásakor',
        details: String(error),
      },
      { status: 500 }
    );
  }
}
