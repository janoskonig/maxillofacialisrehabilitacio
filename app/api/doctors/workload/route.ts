import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

type Level = 'low' | 'medium' | 'high' | 'critical' | 'unavailable';

function getLevel(score: number): Level {
  if (score < 0) return 'unavailable';
  if (score <= 40) return 'low';
  if (score <= 70) return 'medium';
  if (score <= 90) return 'high';
  return 'critical';
}

/**
 * GET /api/doctors/workload
 * Params: horizonDays=7|28, includeDetails=true|false
 * Busyness-o-meter: utilization + pipeline pressure per doctor
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const horizonDays = Math.min(28, Math.max(7, parseInt(request.nextUrl.searchParams.get('horizonDays') || '7', 10)));
    const includeDetails = request.nextUrl.searchParams.get('includeDetails') !== 'false';

    const pool = getDbPool();
    const horizonEnd = new Date();
    horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

    const doctorsResult = await pool.query(
      `SELECT id, email, doktor_neve FROM users
       WHERE active = true AND (role IN ('sebészorvos', 'fogpótlástanász', 'admin') OR doktor_neve IS NOT NULL)
       AND doktor_neve IS NOT NULL AND doktor_neve != ''
       ORDER BY doktor_neve ASC`
    );

    const doctors: Array<{
      userId: string;
      name: string;
      busynessScore: number;
      level: Level;
      utilizationPct: number;
      heldPct: number;
      pipelinePct: number;
      bookedMinutes: number;
      availableMinutes: number;
      heldMinutes: number;
      wipCount: number;
      worklistCount: number;
      overdueCount: number;
      flags: string[];
    }> = [];

    for (const doc of doctorsResult.rows) {
      const [slotStats, bookedStats, wipResult, worklistResult] = await Promise.all([
        pool.query(
          `SELECT
            COALESCE(SUM(COALESCE(ats.duration_minutes, 30)), 0)::int as available_minutes,
            COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND (a.appointment_status IS NULL OR a.appointment_status = 'completed') AND a.start_time > CURRENT_TIMESTAMP THEN COALESCE(a.duration_minutes, 30) ELSE 0 END), 0)::int as booked_minutes,
            COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND a.hold_expires_at IS NOT NULL AND a.hold_expires_at > CURRENT_TIMESTAMP THEN COALESCE(a.duration_minutes, 30) ELSE 0 END), 0)::int as held_minutes
           FROM available_time_slots ats
           LEFT JOIN appointments a ON a.time_slot_id = ats.id
           WHERE ats.user_id = $1 AND ats.start_time >= CURRENT_TIMESTAMP AND ats.start_time <= $2
           AND (ats.state = 'free' OR ats.state = 'booked' OR ats.state = 'held')`,
          [doc.id, horizonEnd]
        ),
        pool.query(
          `SELECT COALESCE(SUM(a.duration_minutes), 0)::int as booked
           FROM appointments a
           JOIN available_time_slots ats ON a.time_slot_id = ats.id
           WHERE ats.user_id = $1 AND a.start_time > CURRENT_TIMESTAMP AND a.start_time <= $2
           AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')`,
          [doc.id, horizonEnd]
        ),
        pool.query(
          `SELECT COUNT(*)::int as cnt FROM patient_episodes pe
           LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
           LEFT JOIN episode_care_team ect ON pe.id = ect.episode_id AND ect.is_primary = true
           WHERE pe.status = 'open' AND (se.stage_code IS NULL OR se.stage_code IN ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5','STAGE_6'))
           AND (pe.assigned_provider_id = $1 OR ect.user_id = $1)`,
          [doc.id]
        ),
        pool.query(
          `SELECT COUNT(*)::int as cnt FROM episode_next_step_cache WHERE provider_id = $1 AND status = 'ready'`,
          [doc.id]
        ),
      ]);

      const availableMinutes = slotStats.rows[0]?.available_minutes ?? 0;
      const bookedMinutes = bookedStats.rows[0]?.booked ?? slotStats.rows[0]?.booked_minutes ?? 0;
      const heldMinutes = slotStats.rows[0]?.held_minutes ?? 0;
      const wipCount = wipResult.rows[0]?.cnt ?? 0;
      const worklistCount = worklistResult.rows[0]?.cnt ?? 0;

      const utilization = availableMinutes > 0 ? bookedMinutes / availableMinutes : 0;
      const holdPressure = availableMinutes > 0 ? heldMinutes / availableMinutes : 0;
      const pipelineNorm = availableMinutes > 0 ? Math.min(1.5, (wipCount + worklistCount) * 30 / availableMinutes) : 0;
      const raw = 0.7 * utilization + 0.1 * holdPressure + 0.2 * pipelineNorm;
      const busynessScore = Math.round(100 * Math.min(raw, 1.5) / 1.5);

      const overdueResult = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM episode_next_step_cache WHERE provider_id = $1 AND overdue_days > 0`,
        [doc.id]
      );
      const overdueCount = overdueResult.rows[0]?.cnt ?? 0;

      const flags: string[] = [];
      if (busynessScore >= 90) flags.push('near_critical_if_new_starts');
      if (availableMinutes === 0 && (wipCount + worklistCount) > 0) flags.push('unavailable');

      doctors.push({
        userId: doc.id,
        name: doc.doktor_neve || doc.email,
        busynessScore,
        level: availableMinutes === 0 ? 'unavailable' : getLevel(busynessScore),
        utilizationPct: Math.round(utilization * 100),
        heldPct: Math.round(holdPressure * 100),
        pipelinePct: Math.round(pipelineNorm * 100),
        bookedMinutes,
        availableMinutes,
        heldMinutes,
        wipCount,
        worklistCount,
        overdueCount,
        flags,
      });
    }

    return NextResponse.json({
      horizonDays,
      generatedAt: new Date().toISOString(),
      doctors: includeDetails ? doctors : doctors.map((d) => ({ userId: d.userId, name: d.name, busynessScore: d.busynessScore, level: d.level })),
    });
  } catch (error) {
    console.error('Error fetching doctors workload:', error);
    return NextResponse.json(
      { error: 'Hiba történt a terhelés lekérdezésekor' },
      { status: 500 }
    );
  }
}
