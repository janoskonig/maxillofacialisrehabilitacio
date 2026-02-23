import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/step-labels/suggestions
 * Returns distinct step labels from all care_pathways.steps_json for autocomplete.
 * Falls back to step_catalog.label_hu for pathways without inline labels.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

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
  } catch (error) {
    console.error('Error fetching step label suggestions:', error);
    return NextResponse.json(
      { error: 'Hiba történt a lépés javaslatok lekérdezésekor' },
      { status: 500 }
    );
  }
}
