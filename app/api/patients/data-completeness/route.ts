import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getPatientDataCompleteness } from '@/lib/patient-data-completeness';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients/data-completeness
 * Vezetői adathiány-riport: betegenként a hiányzó klinikai minimum és
 * kutatási mezők. Csak admin részére.
 */
export const GET = authedHandler(async (_req, { auth }) => {
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Nincs jogosultság a vezetői nézethez' }, { status: 403 });
  }

  const report = await getPatientDataCompleteness();
  return NextResponse.json({ success: true, ...report });
});
