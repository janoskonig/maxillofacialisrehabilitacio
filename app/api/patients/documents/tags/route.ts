import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Get all unique tags from patient documents
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Authentication required
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Get all unique tags from all documents
    // PostgreSQL JSONB array elements extraction
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
  } catch (error) {
    console.error('Hiba a címkék lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a címkék lekérdezésekor' },
      { status: 500 }
    );
  }
}

