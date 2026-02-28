import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { getCurrentEpisodeAndStage } from '@/lib/ohip14-stage';

/**
 * Get OHIP-14 summary with comparison across timepoints
 * GET /api/patients/[id]/ohip14/summary
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const searchParams = req.nextUrl.searchParams;
  const episodeId = searchParams.get('episodeId');

  let finalEpisodeId: string | null = episodeId;
  if (!finalEpisodeId) {
    const { episodeId: activeEpisodeId } = await getCurrentEpisodeAndStage(pool, patientId);
    finalEpisodeId = activeEpisodeId;
  }

  // Get all responses for this patient and episode
  let query = `
    SELECT 
      id,
      patient_id as "patientId",
      episode_id as "episodeId",
      timepoint,
      stage_code as "stageCode",
      completed_at as "completedAt",
      completed_by_patient as "completedByPatient",
      total_score as "totalScore",
      functional_limitation_score as "functionalLimitationScore",
      physical_pain_score as "physicalPainScore",
      psychological_discomfort_score as "psychologicalDiscomfortScore",
      physical_disability_score as "physicalDisabilityScore",
      psychological_disability_score as "psychologicalDisabilityScore",
      social_disability_score as "socialDisabilityScore",
      handicap_score as "handicapScore",
      locked_at as "lockedAt",
      created_at as "createdAt"
    FROM ohip14_responses
    WHERE patient_id = $1
  `;

  const queryParams: any[] = [patientId];

  if (finalEpisodeId) {
    query += ` AND episode_id = $2`;
    queryParams.push(finalEpisodeId);
  }

  query += ` ORDER BY timepoint, completed_at DESC`;

  const result = await pool.query(query, queryParams);

  // Group by timepoint (get most recent for each)
  const timepointMap: Record<string, any> = {};
  result.rows.forEach((row) => {
    if (!timepointMap[row.timepoint]) {
      timepointMap[row.timepoint] = {
        timepoint: row.timepoint,
        stageCode: row.stageCode ?? null,
        totalScore: row.totalScore,
        functionalLimitationScore: row.functionalLimitationScore,
        physicalPainScore: row.physicalPainScore,
        psychologicalDiscomfortScore: row.psychologicalDiscomfortScore,
        physicalDisabilityScore: row.physicalDisabilityScore,
        psychologicalDisabilityScore: row.psychologicalDisabilityScore,
        socialDisabilityScore: row.socialDisabilityScore,
        handicapScore: row.handicapScore,
        completedAt: row.completedAt?.toISOString(),
        lockedAt: row.lockedAt?.toISOString(),
      };
    }
  });

  const summary = {
    T0: timepointMap['T0'] || null,
    T1: timepointMap['T1'] || null,
    T2: timepointMap['T2'] || null,
    T3: timepointMap['T3'] || null,
    episodeId: finalEpisodeId,
  };

  const calcDiff = (a: any, b: any) => ({
    totalScore: b.totalScore - a.totalScore,
    functionalLimitation: b.functionalLimitationScore - a.functionalLimitationScore,
    physicalPain: b.physicalPainScore - a.physicalPainScore,
    psychologicalDiscomfort: b.psychologicalDiscomfortScore - a.psychologicalDiscomfortScore,
    physicalDisability: b.physicalDisabilityScore - a.physicalDisabilityScore,
    psychologicalDisability: b.psychologicalDisabilityScore - a.psychologicalDisabilityScore,
    socialDisability: b.socialDisabilityScore - a.socialDisabilityScore,
    handicap: b.handicapScore - a.handicapScore,
  });

  const changes = {
    T0toT1: summary.T0 && summary.T1 ? calcDiff(summary.T0, summary.T1) : null,
    T1toT2: summary.T1 && summary.T2 ? calcDiff(summary.T1, summary.T2) : null,
    T0toT2: summary.T0 && summary.T2 ? calcDiff(summary.T0, summary.T2) : null,
    T2toT3: summary.T2 && summary.T3 ? calcDiff(summary.T2, summary.T3) : null,
    T0toT3: summary.T0 && summary.T3 ? calcDiff(summary.T0, summary.T3) : null,
  };

  return NextResponse.json({
    summary,
    changes,
  });
});
