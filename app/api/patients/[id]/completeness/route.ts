import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import {
  blockingClinicalMissing,
  getPatientCompletenessRow,
} from '@/lib/patient-data-completeness';

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

  const blocking = blockingClinicalMissing(row.clinicalMissing);

  return NextResponse.json({
    score: row.completenessScore,
    // Kötelező klinikai hiányok száma — az ajánlott (pl. email) nem számít ide.
    clinicalMissing: blocking.length,
    // Ajánlott, nem kötelező hiányok (severity 'warning'): jelzés, nem kapu.
    recommendedMissing: row.clinicalMissing.length - blocking.length,
    researchMissing: row.researchMissing.length,
    clinicalComplete: row.clinicalComplete,
    // Tételes hiánylista a betegkartonon megjelenő, deep-linkelhető checklisthez.
    clinicalMissingItems: row.clinicalMissing.map((m) => ({
      key: m.key,
      label: m.label,
      severity: m.severity ?? 'error',
    })),
    researchMissingItems: row.researchMissing.map((m) => ({ key: m.key, label: m.label })),
  });
});
