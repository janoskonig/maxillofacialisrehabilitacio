import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { RESEARCH_EXPORT_MODE } from '@/lib/research-registry/operational-policy';
import { filterPatientsEligibleForResearchExport } from '@/lib/research-registry/research-export-gate';
import {
  buildAnalysisRow,
  ANALYSIS_VARIABLES,
  type AnalysisRow,
} from '@/lib/research-registry/analysis-projection';
import { computeTableOne } from '@/lib/research-registry/table-one';
import { generateCodebook } from '@/lib/research-registry/codebook';
import { assertExportPhiSafe } from '@/lib/research-registry/phi-safety';
import { getPatientDataCompleteness } from '@/lib/patient-data-completeness';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/research-registry/analysis-dataset?groupBy=etiologia&format=json|csv
 *
 * Elemzésre kész, DE-IDENTIFIKÁLT kutatási adatkészlet a beleegyezésre jogosult
 * betegekről, kódkönyvvel és Table 1-gyel. A consent/governance kaput (a meglévő
 * RESEARCH_EXPORT_MODE) tiszteletben tartja: `disabled` módban 0 jogosult beteg
 * (üres adatkészlet, de a struktúra és a kódkönyv látszik). A PHI-biztonságot
 * minden soron ellenőrzi. Csak admin.
 */
export const GET = roleHandler(['admin'], async (req) => {
  const url = req.nextUrl;
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const groupBy = url.searchParams.get('groupBy');
  const salt = process.env.RESEARCH_DEID_SALT ?? '';

  const pool = getDbPool();

  const { rows: baseRows } = await pool.query(
    `SELECT
        p.id,
        p.szuletesi_datum,
        p.iranyitoszam,
        p.nem,
        a.kezelesre_erkezes_indoka,
        a.maxilladefektus_van,
        a.mandibuladefektus_van,
        a.brown_fuggoleges_osztaly,
        a.brown_vizszintes_komponens,
        a.kovacs_dobak_osztaly,
        a.tnm_staging,
        a.radioterapia,
        a.radioterapia_dozis_gy,
        a.chemoterapia,
        a.dohanyzas_szam_ertek,
        (SELECT o.total_score FROM ohip14_responses o
          WHERE o.patient_id = p.id AND o.timepoint = 'T0'
          ORDER BY o.completed_at DESC NULLS LAST LIMIT 1) AS ohip_t0_total,
        (SELECT o.total_score FROM ohip14_responses o
          WHERE o.patient_id = p.id AND o.timepoint = 'T1'
          ORDER BY o.completed_at DESC NULLS LAST LIMIT 1) AS ohip_t1_total,
        (SELECT o.total_score FROM ohip14_responses o
          WHERE o.patient_id = p.id AND o.timepoint = 'T2'
          ORDER BY o.completed_at DESC NULLS LAST LIMIT 1) AS ohip_t2_total,
        (SELECT o.total_score FROM ohip14_responses o
          WHERE o.patient_id = p.id AND o.timepoint = 'T3'
          ORDER BY o.completed_at DESC NULLS LAST LIMIT 1) AS ohip_t3_total,
        (SELECT pr.composite_score FROM pro_responses pr
          WHERE pr.patient_id = p.id AND pr.instrument = 'UWQOL' AND pr.timepoint = 'T0'
          ORDER BY pr.completed_at DESC NULLS LAST LIMIT 1) AS uwqol_composite_t0,
        (SELECT pr.composite_score FROM pro_responses pr
          WHERE pr.patient_id = p.id AND pr.instrument = 'UWQOL' AND pr.timepoint = 'T1'
          ORDER BY pr.completed_at DESC NULLS LAST LIMIT 1) AS uwqol_composite_t1,
        (SELECT pr.composite_score FROM pro_responses pr
          WHERE pr.patient_id = p.id AND pr.instrument = 'UWQOL' AND pr.timepoint = 'T2'
          ORDER BY pr.completed_at DESC NULLS LAST LIMIT 1) AS uwqol_composite_t2,
        (SELECT pr.composite_score FROM pro_responses pr
          WHERE pr.patient_id = p.id AND pr.instrument = 'UWQOL' AND pr.timepoint = 'T3'
          ORDER BY pr.completed_at DESC NULLS LAST LIMIT 1) AS uwqol_composite_t3
     FROM patients p
     LEFT JOIN patient_anamnesis a ON a.patient_id = p.id`,
  );

  // Beleegyezés / governance kapu — disabled módban üres lesz a jogosult halmaz.
  const ids = baseRows.map((r) => String(r.id));
  const { eligible, excluded } = await filterPatientsEligibleForResearchExport(ids, pool);
  const eligibleSet = new Set(eligible);

  // Adat-teljességi pontszám hozzárendelése (a JS-ben számolt értékből).
  const completeness = await getPatientDataCompleteness();
  const scoreById = new Map(completeness.patients.map((p) => [p.patientId, p.completenessScore]));

  const analysisRows: AnalysisRow[] = baseRows
    .filter((r) => eligibleSet.has(String(r.id)))
    .map((r) =>
      buildAnalysisRow(
        { ...r, completeness_score: scoreById.get(String(r.id)) ?? null },
        salt,
      ),
    );

  // Védőháló: a kimenet sose tartalmazzon PHI-t.
  assertExportPhiSafe(analysisRows);

  if (format === 'csv') {
    const csv = toCsv(analysisRows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="analysis_dataset_${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  }

  const tableOne = computeTableOne(analysisRows, { groupBy });
  const codebook = generateCodebook();

  return NextResponse.json({
    success: true,
    mode: RESEARCH_EXPORT_MODE,
    note:
      RESEARCH_EXPORT_MODE === 'disabled'
        ? 'A kutatási kohorsz-export jelenleg tiltva (RESEARCH_EXPORT_MODE=disabled). A struktúra és a kódkönyv látszik, de nincs jogosult beteg, amíg az adatgazda engedélyezi a consent-alapú módot.'
        : undefined,
    eligibleCount: analysisRows.length,
    excludedCount: excluded.length,
    rows: analysisRows,
    tableOne,
    codebook,
    timestamp: new Date().toISOString(),
  });
});

/** Egyszerű, RFC4180-szerű CSV az elemzési változók fix oszlopsorrendjével. */
function toCsv(rows: AnalysisRow[]): string {
  const cols = ANALYSIS_VARIABLES.map((v) => v.key);
  const esc = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
