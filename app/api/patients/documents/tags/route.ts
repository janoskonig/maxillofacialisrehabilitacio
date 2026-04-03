import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { isLegacyDocumentTagSupersededInPicker } from '@/lib/patient-portrait-tag';

export const dynamic = 'force-dynamic';

/**
 * Javasolt címkék ha még kevés van a DB-ben.
 * Önarckép/portré → kanonikus **foto**; OP/panoráma → **op** (régi orthopantomogram / önarckép stb. nem külön javaslat).
 */
const SUGGESTED_DOCUMENT_TAGS = ['op', 'foto'];

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

  const fromDb = result.rows.map((row) => row.tag).filter(Boolean);
  const tags = Array.from(new Set([...SUGGESTED_DOCUMENT_TAGS, ...fromDb]))
    .filter((t) => typeof t === 'string' && t.trim() && !isLegacyDocumentTagSupersededInPicker(t))
    .sort((a, b) => a.localeCompare(b, 'hu'));

  return NextResponse.json({ tags }, { status: 200 });
});
