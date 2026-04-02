import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { getBnoCodesList } from '@/lib/bno-codes-data';

export const dynamic = 'force-dynamic';

const cacheHeaders = { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200' };

export const GET = apiHandler(async () => {
  const bnoCodes = getBnoCodesList();
  if (bnoCodes.length === 0) {
    return NextResponse.json({ error: 'BNO Excel file not found or empty' }, { status: 404 });
  }
  return NextResponse.json(bnoCodes, { headers: cacheHeaders });
});
