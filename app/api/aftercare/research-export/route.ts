import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { budapestToday } from '@/lib/aftercare/model';
import { loadAftercareWorkspace } from '@/lib/aftercare/service';
import { buildWorkloadResearchRows, researchKey, WORKLOAD_DATASET_VERSION, WORKLOAD_DEFINITIONS } from '@/lib/aftercare/research';
import { getComplianceFeatureFlag } from '@/lib/research-registry/feature-flags';
import { assertResearchExportModeAllowsCohortExport, filterPatientsEligibleForResearchExport, ResearchExportBlockedError } from '@/lib/research-registry/research-export-gate';
import { createAnalysisExport, CURRENT_EXPORT_SCHEMA_VERSION } from '@/lib/research-registry/export-service';

export const dynamic = 'force-dynamic';
export const POST = roleHandler(['admin', 'fogpótlástanász'], async (_req, { auth }) => {
  const pool = getDbPool();
  if (!(await getComplianceFeatureFlag('research_export_pipeline'))) throw new HttpError(403, 'A kutatási export jelenleg nincs engedélyezve');
  try { await assertResearchExportModeAllowsCohortExport(pool); }
  catch (e) { if (e instanceof ResearchExportBlockedError) throw new HttpError(403, e.message); throw e; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const patients = await db.query('SELECT DISTINCT patient_id FROM prostheses ORDER BY patient_id');
    // Eligibility is checked in the same snapshot as the clinical projection.
    const { eligible, excluded } = await filterPatientsEligibleForResearchExport(patients.rows.map((r) => r.patient_id), db as unknown as typeof pool);
    if (!eligible.length) throw new HttpError(403, 'Nincs kutatásba exportálható fogpótlásos beteg');
    const asOf = budapestToday();
    const rows: Record<string, unknown>[] = [];
    for (const patientId of eligible) {
      rows.push(...buildWorkloadResearchRows(patientId, await loadAftercareWorkspace(patientId, db), asOf));
      const changes = await db.query(`SELECT h.id, h.entity, h.operation, h.episode_id,
        COALESCE(h.new_data->>'work_phase_code', h.old_data->>'work_phase_code') AS phase_code,
        h.old_data->>'status' AS old_status, h.new_data->>'status' AS new_status,
        h.old_data->>'duration_minutes' AS old_minutes, h.new_data->>'duration_minutes' AS new_minutes
        FROM prosthesis_workload_history h WHERE h.episode_id IN (SELECT episode_id FROM prostheses WHERE patient_id = $1)
        AND h.entity IN ('episode_work_phases', 'patient_episodes') ORDER BY h.id`, [patientId]);
      changes.rows.forEach((h) => rows.push({ recordKey: `plan_change:${researchKey(String(h.id), 'history')}`, recordType: 'plan_change',
        subjectKey: researchKey(patientId, 'patient'), episodeKey: researchKey(h.episode_id, 'episode'),
        entity: h.entity, operation: h.operation, phaseCode: h.phase_code,
        oldStatus: h.old_status, newStatus: h.new_status, oldMinutes: h.old_minutes, newMinutes: h.new_minutes }));
    }
    const queryDefinition = { dataset: WORKLOAD_DATASET_VERSION, asOf, definitions: WORKLOAD_DEFINITIONS };
    const result = await createAnalysisExport({ exportLabel: `prosthesis_workload_${asOf}`,
      schemaVersion: CURRENT_EXPORT_SCHEMA_VERSION, queryDefinition, rows, keyColumns: ['recordKey'],
      filterPolicy: { consentAndEthicsGated: true, excludedCount: excluded.length }, createdBy: auth.email, patientIds: eligible,
    }, db as unknown as typeof pool);
    if (!result) throw new HttpError(503, 'Az exportfolyamat nem elérhető');
    await db.query('COMMIT');
    return NextResponse.json({ exportId: result.id, contentHash: result.contentHash,
      datasetVersion: WORKLOAD_DATASET_VERSION, asOf, definitions: WORKLOAD_DEFINITIONS,
      excludedCount: excluded.length, rows }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { await db.query('ROLLBACK'); throw e; }
  finally { db.release(); }
});
