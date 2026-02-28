import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT DISTINCT tag
     FROM patient_documents,
          jsonb_array_elements_text(tags) AS tag
     WHERE tags IS NOT NULL 
       AND jsonb_array_length(tags) > 0
     ORDER BY tag ASC`
  );

  const tags = result.rows.map(row => row.tag).filter(Boolean);

  return NextResponse.json({ tags }, { status: 200 });
});
