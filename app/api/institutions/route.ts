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
  // Admin által kezelt törzs (migration 067); csak az aktív intézmények
  // jelennek meg az űrlap-autocomplete-ben.
  const result = await pool.query(
    `SELECT name FROM referral_institutions
     WHERE active = TRUE
     ORDER BY name ASC`
  );

  const institutions = result.rows.map(row => row.name);
  setCache(CACHE_KEY, institutions, INSTITUTION_TTL);

  return NextResponse.json({ institutions }, { headers: cacheHeaders });
});
