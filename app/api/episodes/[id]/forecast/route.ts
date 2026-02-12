import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { nextRequiredStep, isBlocked } from '@/lib/next-step-engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/forecast
 * Returns case-level forecast: remaining visits (p50/p80), completion window, assumptions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const episodeId = params.id;
    const pool = getDbPool();

    const episodeResult = await pool.query(
      `SELECT pe.id, pe.care_pathway_id as "carePathwayId", pe.patient_id as "patientId"
       FROM patient_episodes pe
       WHERE pe.id = $1`,
      [episodeId]
    );

    if (episodeResult.rows.length === 0) {
      return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
    }

    const episode = episodeResult.rows[0];
    const nextStepResult = await nextRequiredStep(episodeId);

    if (isBlocked(nextStepResult)) {
      return NextResponse.json({
        carePathwayId: episode.carePathwayId,
        status: 'blocked',
        blockedReason: nextStepResult.reason,
        requiredPrereqs: nextStepResult.required_prereq_keys,
        remainingVisitsP50: null,
        remainingVisitsP80: null,
        completionWindowStart: null,
        completionWindowEnd: null,
        assumptions: ['blocked', 'pathway-level0'],
      });
    }

    let steps: Array<{ step_code: string; pool: string }> | null = null;
    if (episode.carePathwayId) {
      const pathwayResult = await pool.query(
        `SELECT steps_json FROM care_pathways WHERE id = $1`,
        [episode.carePathwayId]
      );
      steps = pathwayResult.rows[0]?.steps_json as Array<{ step_code: string; pool: string }> | null;
    }
    const workSteps = steps?.filter((s) => s.pool === 'work').length ?? 4;
    const remainingVisitsP50 = Math.max(1, Math.ceil(workSteps * 0.6));
    const remainingVisitsP80 = Math.max(remainingVisitsP50, Math.ceil(workSteps * 0.9));

    const cadenceDays = 14;
    const completionWindowStart = new Date(nextStepResult.earliest_date);
    completionWindowStart.setDate(completionWindowStart.getDate() + remainingVisitsP50 * cadenceDays);
    const completionWindowEnd = new Date(nextStepResult.latest_date);
    completionWindowEnd.setDate(completionWindowEnd.getDate() + remainingVisitsP80 * cadenceDays);

    return NextResponse.json({
      carePathwayId: episode.carePathwayId,
      remainingVisitsP50,
      remainingVisitsP80,
      completionWindowStart: completionWindowStart.toISOString(),
      completionWindowEnd: completionWindowEnd.toISOString(),
      nextStep: nextStepResult.step_code,
      nextStepWindow: {
        start: nextStepResult.earliest_date.toISOString(),
        end: nextStepResult.latest_date.toISOString(),
      },
      assumptions: ['level0-pathway', 'cadence-from-steps', 'noShow-adjustment-off'],
    });
  } catch (error) {
    console.error('Error fetching episode forecast:', error);
    return NextResponse.json(
      { error: 'Hiba történt a prognózis lekérdezésekor' },
      { status: 500 }
    );
  }
}
