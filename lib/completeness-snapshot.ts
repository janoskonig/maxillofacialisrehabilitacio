import { getDbPool } from '@/lib/db';
import { getPatientDataCompleteness } from '@/lib/patient-data-completeness';

/**
 * Napi adat-teljességi pillanatkép — a vezetői nézet trend-grafikonjához.
 * Egy sor / nap (idempotens): ha a mai sor már megvan, alapból nem számolunk
 * újra (a teljes completeness-riport drága). `force`-szal felülírható.
 */

export type CompletenessSnapshot = {
  snapshotDate: string;
  total: number;
  avgScore: number;
  clinicalComplete: number;
  researchReady: number;
  withWarnings: number;
};

export type RecordSnapshotResult =
  | { recorded: true; snapshot: CompletenessSnapshot }
  | { recorded: false; reason: 'already_today' };

export async function recordCompletenessSnapshot(
  options?: { force?: boolean },
): Promise<RecordSnapshotResult> {
  const pool = getDbPool();

  if (!options?.force) {
    const exists = await pool.query(
      `SELECT 1 FROM data_completeness_snapshot WHERE snapshot_date = CURRENT_DATE LIMIT 1`,
    );
    if (exists.rows.length > 0) return { recorded: false, reason: 'already_today' };
  }

  const report = await getPatientDataCompleteness();
  const s = report.summary;

  const res = await pool.query(
    `INSERT INTO data_completeness_snapshot
       (snapshot_date, total, avg_score, clinical_complete, research_ready, with_warnings)
     VALUES (CURRENT_DATE, $1, $2, $3, $4, $5)
     ON CONFLICT (snapshot_date) DO UPDATE SET
       total = EXCLUDED.total,
       avg_score = EXCLUDED.avg_score,
       clinical_complete = EXCLUDED.clinical_complete,
       research_ready = EXCLUDED.research_ready,
       with_warnings = EXCLUDED.with_warnings,
       created_at = NOW()
     RETURNING snapshot_date, total, avg_score, clinical_complete, research_ready, with_warnings`,
    [s.total, s.avgCompletenessScore, s.clinicalComplete, s.researchReady, s.withWarnings],
  );

  return { recorded: true, snapshot: mapRow(res.rows[0]) };
}

/** A legutóbbi N nap pillanatképei (régi → új, a grafikon X tengelyéhez). */
export async function getCompletenessSnapshots(limitDays = 90): Promise<CompletenessSnapshot[]> {
  const pool = getDbPool();
  const days = Number.isFinite(limitDays) && limitDays > 0 ? Math.min(Math.floor(limitDays), 730) : 90;
  const res = await pool.query(
    `SELECT snapshot_date, total, avg_score, clinical_complete, research_ready, with_warnings
       FROM data_completeness_snapshot
      WHERE snapshot_date > CURRENT_DATE - ($1::int)
      ORDER BY snapshot_date ASC`,
    [days],
  );
  return res.rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): CompletenessSnapshot {
  return {
    snapshotDate:
      r.snapshot_date instanceof Date
        ? r.snapshot_date.toISOString().slice(0, 10)
        : String(r.snapshot_date).slice(0, 10),
    total: Number(r.total),
    avgScore: Number(r.avg_score),
    clinicalComplete: Number(r.clinical_complete),
    researchReady: Number(r.research_ready),
    withWarnings: Number(r.with_warnings),
  };
}
