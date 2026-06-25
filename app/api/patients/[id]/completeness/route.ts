import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getPatientCompletenessRow } from '@/lib/patient-data-completeness';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients/[id]/completeness
 * Egy beteg adat-teljességi pontszáma + hiánylistája a betegkartonon
 * megjelenő finom mutatóhoz. (A vezetői, betegek közti riport az
 * /api/patients/data-completeness alatt, csak adminnak.)
 */
export const GET = authedHandler(async (_req, { params }) => {
  const row = await getPatientCompletenessRow(params.id);
  if (!row) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  return NextResponse.json({
    score: row.completenessScore,
    clinicalMissing: row.clinicalMissing.length,
    researchMissing: row.researchMissing.length,
    clinicalComplete: row.clinicalComplete,
    // Tételes hiánylista a betegkartonon megjelenő, deep-linkelhető checklisthez.
    clinicalMissingItems: row.clinicalMissing.map((m) => ({ key: m.key, label: m.label })),
    researchMissingItems: row.researchMissing.map((m) => ({ key: m.key, label: m.label })),
  });
});
