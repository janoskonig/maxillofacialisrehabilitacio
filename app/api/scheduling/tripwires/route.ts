import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scheduling/tripwires
 * Production tripwires: daily metrics + fix-now actions.
 * Admin / fogpótlástanász only.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const pool = getDbPool();

    const [
      oneHardNextViolations,
      heldPastExpiry,
      blockedSlots,
      wipNoHardNext,
      overrideRateByPathway,
      medianWipAge,
    ] = await Promise.all([
      pool.query(
        `SELECT pe.id as "episodeId", pe.patient_id as "patientId", array_agg(a.id) as "appointmentIds"
         FROM appointments a
         JOIN patient_episodes pe ON a.episode_id = pe.id
         WHERE a.pool = 'work' AND a.start_time > CURRENT_TIMESTAMP
         AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
         AND a.requires_precommit = false
         GROUP BY pe.id, pe.patient_id
         HAVING COUNT(*) > 1`
      ),
      pool.query(
        `SELECT COUNT(*)::int as cnt FROM appointments a
         JOIN available_time_slots ats ON a.time_slot_id = ats.id
         WHERE a.hold_expires_at IS NOT NULL AND a.hold_expires_at < CURRENT_TIMESTAMP
         AND (a.appointment_status IS NULL OR a.appointment_status != 'cancelled_by_patient')
         AND ats.state IN ('held', 'offered')`
      ),
      pool.query(
        `SELECT COUNT(*)::int as cnt FROM available_time_slots WHERE state = 'blocked'`
      ),
      pool.query(
        `WITH wip AS (
           SELECT pe.id FROM patient_episodes pe
           LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
           WHERE pe.status = 'open' AND (se.stage_code IS NULL OR se.stage_code IN ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5','STAGE_6'))
         SELECT COUNT(*)::int as cnt FROM wip w
         WHERE NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.episode_id = w.id AND a.pool = 'work' AND a.start_time > CURRENT_TIMESTAMP
           AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
         )`
      ),
      pool.query(
        `SELECT cp.id as "pathwayId", cp.name as "pathwayName",
                COUNT(DISTINCT soa.id)::int as "overrideCount",
                COUNT(DISTINCT pe.id)::int as "episodeCount",
                CASE WHEN COUNT(DISTINCT pe.id) > 0
                  THEN ROUND(100.0 * COUNT(DISTINCT soa.id) / NULLIF(COUNT(DISTINCT pe.id), 0), 1)
                  ELSE 0 END as "overrideRatePct"
         FROM care_pathways cp
         LEFT JOIN patient_episodes pe ON pe.care_pathway_id = cp.id AND pe.status = 'open'
         LEFT JOIN scheduling_override_audit soa ON soa.episode_id = pe.id
         GROUP BY cp.id, cp.name
         HAVING COUNT(DISTINCT soa.id) > 0`
      ),
      pool.query(
        `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - pe.opened_at)) / 86400)::int as "medianDays"
         FROM patient_episodes pe
         LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
         WHERE pe.status = 'open' AND (se.stage_code IS NULL OR se.stage_code IN ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5','STAGE_6'))`
      ),
    ]);

    const violations = oneHardNextViolations.rows;
    const heldPastExpiryCount = heldPastExpiry.rows[0]?.cnt ?? 0;
    const blockedCount = blockedSlots.rows[0]?.cnt ?? 0;
    const wipNoHardNextCount = wipNoHardNext.rows[0]?.cnt ?? 0;
    const medianDays = medianWipAge.rows[0]?.medianDays ?? 0;

    const actions: Array<{ id: string; label: string; severity: 'critical' | 'warning' | 'info'; count?: number; link?: string }> = [];

    if (violations.length > 0) {
      actions.push({ id: 'one_hard_next', label: 'One-hard-next violations – fix now', severity: 'critical', count: violations.length });
    }
    if (heldPastExpiryCount > 0) {
      actions.push({ id: 'held_expired', label: 'Slots held/offered past expiry – cleanup', severity: 'warning', count: heldPastExpiryCount });
    }
    if (blockedCount > 0) {
      actions.push({ id: 'blocked_slots', label: 'Blocked slots (Google conflicts) – resolve', severity: 'warning', count: blockedCount });
    }
    if (wipNoHardNextCount > 0) {
      actions.push({ id: 'wip_no_hard_next', label: 'WIP episodes without hard-next – schedule', severity: 'warning', count: wipNoHardNextCount });
    }
    overrideRateByPathway.rows.forEach((r: { pathwayId: string; pathwayName: string; overrideRatePct: number }) => {
      if (r.overrideRatePct > 20) {
        actions.push({ id: 'override_rate', label: `Pathway "${r.pathwayName}" override rate high (${r.overrideRatePct}%)`, severity: 'info' });
      }
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      metrics: {
        oneHardNextViolations: violations.length,
        violationsDetail: violations,
        heldPastExpiry: heldPastExpiryCount,
        blockedSlots: blockedCount,
        wipNoHardNext: wipNoHardNextCount,
        medianWipAgeDays: medianDays,
        overrideRateByPathway: overrideRateByPathway.rows,
      },
      actions,
      ok: violations.length === 0 && heldPastExpiryCount === 0,
    });
  } catch (error) {
    console.error('Error fetching tripwires:', error);
    return NextResponse.json(
      { error: 'Hiba történt a tripwire lekérdezésekor' },
      { status: 500 }
    );
  }
}
