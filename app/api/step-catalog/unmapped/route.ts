import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getUnmappedStepCodes } from '@/lib/step-catalog-cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/step-catalog/unmapped — step_code-ok care_pathways.steps_json-ból,
 * amelyek nincsenek a step_catalog-ban. DB aggregálás, cache TTL.
 * Auth: admin + fogpótlástanász
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const items = await getUnmappedStepCodes();

    return NextResponse.json({ items });
  } catch (error) {
    console.error('Error fetching unmapped step codes:', error);
    return NextResponse.json(
      { error: 'Hiba történt az unmapped lépések lekérdezésekor' },
      { status: 500 }
    );
  }
}
