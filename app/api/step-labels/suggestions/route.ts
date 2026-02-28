import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();

  const result = await pool.query(`
    SELECT DISTINCT label FROM (
      SELECT elem->>'label' AS label
      FROM care_pathways, jsonb_array_elements(steps_json) elem
      WHERE elem->>'label' IS NOT NULL AND elem->>'label' <> ''
      UNION
      SELECT label_hu AS label
      FROM step_catalog
      WHERE is_active = true
    ) sub
    ORDER BY label
  `);

  const labels: string[] = result.rows.map((r: { label: string }) => r.label);

  return NextResponse.json({ labels });
});
