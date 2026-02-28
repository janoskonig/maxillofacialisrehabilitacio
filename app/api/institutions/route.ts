import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { getCached, setCache, INSTITUTION_TTL } from '@/lib/catalog-cache';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'institutions';

export const GET = apiHandler(async (_req, { correlationId }) => {
  const cacheHeaders = { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200' };
  const cached = getCached<string[]>(CACHE_KEY);
  if (cached) return NextResponse.json({ institutions: cached }, { headers: cacheHeaders });

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT DISTINCT intezmeny 
     FROM users 
     WHERE intezmeny IS NOT NULL AND intezmeny != ''
     ORDER BY intezmeny ASC`
  );

  const institutions = result.rows.map(row => row.intezmeny);
  setCache(CACHE_KEY, institutions, INSTITUTION_TTL);

  return NextResponse.json({ institutions }, { headers: cacheHeaders });
});
