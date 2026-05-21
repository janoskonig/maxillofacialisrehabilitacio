import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import {
  createAnalysisExport,
  CURRENT_EXPORT_SCHEMA_VERSION,
} from '@/lib/research-registry/export-service';
import { getComplianceFeatureFlag } from '@/lib/research-registry/feature-flags';
import { deidentifyPatientRow } from '@/lib/research-registry/research-patient-view';
import {
  assertResearchExportModeAllowsCohortExport,
  ResearchExportBlockedError,
  filterPatientsEligibleForResearchExport,
} from '@/lib/research-registry/research-export-gate';

export const dynamic = 'force-dynamic';

/** GET — recent frozen analysis exports */
export const GET = roleHandler(['admin'], async (req) => {
  const enabled = await getComplianceFeatureFlag('research_export_pipeline');
  if (!enabled) {
    return NextResponse.json({ enabled: false, exports: [] });
  }

  const limit = Math.min(
    50,
    Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10) || 10)
  );

  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id, export_label, schema_version, row_count, content_hash, created_at, status
     FROM analysis_exports
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  return NextResponse.json({ enabled: true, exports: r.rows });
});

/** POST — register frozen research export (de-identified patient cohort) */
export const POST = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const enabled = await getComplianceFeatureFlag('research_export_pipeline');
  if (!enabled) {
    return NextResponse.json(
      { error: 'research_export_pipeline flag is disabled' },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    exportLabel?: string;
    source?: 'patients' | 'custom';
    rows?: Record<string, unknown>[];
    keyColumns?: string[];
    queryDefinition?: Record<string, unknown>;
    filterPolicy?: Record<string, unknown>;
  };

  const pool = getDbPool();
  let rows: Record<string, unknown>[] = body.rows ?? [];
  let patientIds: string[] = [];

  if (body.source === 'patients' || (!body.rows?.length && body.source !== 'custom')) {
    try {
      assertResearchExportModeAllowsCohortExport();
    } catch (e) {
      if (e instanceof ResearchExportBlockedError) {
        return NextResponse.json({ error: e.message }, { status: 403 });
      }
      throw e;
    }

    const patients = await pool.query(`
      SELECT p.id, p.nem, p.szuletesi_datum, p.iranyitoszam, p.domain_revision,
             p.legacy_compliance_status, a.kezelesre_erkezes_indoka
      FROM patients p
      LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
    `);
    const allIds = patients.rows.map((r) => String(r.id));
    const { eligible, excluded } = await filterPatientsEligibleForResearchExport(
      allIds,
      pool
    );
    if (eligible.length === 0) {
      return NextResponse.json(
        {
          error:
            'Nincs exportálható beteg (consent / compliance). Kutatási export jelenleg nem aktív.',
          excludedCount: excluded.length,
        },
        { status: 403 }
      );
    }
    const eligibleSet = new Set(eligible);
    const filtered = patients.rows.filter((r) => eligibleSet.has(String(r.id)));
    rows = filtered.map((row) => ({
      ...deidentifyPatientRow(row as Record<string, unknown>),
    }));
    patientIds = eligible;
  }

  const keyColumns =
    body.keyColumns ?? ['anonymizedSubjectKey', 'ageBandStart', 'regionPrefix', 'nem'];

  const exportLabel =
    body.exportLabel?.trim() ||
    `research_cohort_${new Date().toISOString().slice(0, 10)}`;

  const result = await createAnalysisExport(
    {
      exportLabel,
      schemaVersion: CURRENT_EXPORT_SCHEMA_VERSION,
      queryDefinition: body.queryDefinition ?? { source: body.source ?? 'patients' },
      filterPolicy: body.filterPolicy ?? {},
      rows,
      keyColumns,
      createdBy: auth.email,
      patientIds,
    },
    pool
  );

  if (!result) {
    return NextResponse.json(
      { error: 'Export pipeline unavailable' },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      exportId: result.id,
      contentHash: result.contentHash,
      rowCount: rows.length,
    },
    { status: 201 }
  );
});
