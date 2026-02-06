import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { OHIP14Response } from '@/lib/types';

/**
 * Get OHIP-14 summary with comparison across timepoints
 * GET /api/patients/[id]/ohip14/summary
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;
    const searchParams = request.nextUrl.searchParams;
    const episodeId = searchParams.get('episodeId');

    // Get active episode if not specified
    let finalEpisodeId = episodeId;
    if (!finalEpisodeId) {
      const currentStageResult = await pool.query(
        `SELECT episode_id 
         FROM patient_current_stage 
         WHERE patient_id = $1`,
        [patientId]
      );

      if (currentStageResult.rows.length > 0) {
        finalEpisodeId = currentStageResult.rows[0].episode_id;
      }
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
      episodeId: finalEpisodeId,
    };

    // Calculate changes
    const changes = {
      T0toT1: summary.T0 && summary.T1
        ? {
            totalScore: summary.T1.totalScore - summary.T0.totalScore,
            functionalLimitation: summary.T1.functionalLimitationScore - summary.T0.functionalLimitationScore,
            physicalPain: summary.T1.physicalPainScore - summary.T0.physicalPainScore,
            psychologicalDiscomfort: summary.T1.psychologicalDiscomfortScore - summary.T0.psychologicalDiscomfortScore,
            physicalDisability: summary.T1.physicalDisabilityScore - summary.T0.physicalDisabilityScore,
            psychologicalDisability: summary.T1.psychologicalDisabilityScore - summary.T0.psychologicalDisabilityScore,
            socialDisability: summary.T1.socialDisabilityScore - summary.T0.socialDisabilityScore,
            handicap: summary.T1.handicapScore - summary.T0.handicapScore,
          }
        : null,
      T1toT2: summary.T1 && summary.T2
        ? {
            totalScore: summary.T2.totalScore - summary.T1.totalScore,
            functionalLimitation: summary.T2.functionalLimitationScore - summary.T1.functionalLimitationScore,
            physicalPain: summary.T2.physicalPainScore - summary.T1.physicalPainScore,
            psychologicalDiscomfort: summary.T2.psychologicalDiscomfortScore - summary.T1.psychologicalDiscomfortScore,
            physicalDisability: summary.T2.physicalDisabilityScore - summary.T1.physicalDisabilityScore,
            psychologicalDisability: summary.T2.psychologicalDisabilityScore - summary.T1.psychologicalDisabilityScore,
            socialDisability: summary.T2.socialDisabilityScore - summary.T1.socialDisabilityScore,
            handicap: summary.T2.handicapScore - summary.T1.handicapScore,
          }
        : null,
      T0toT2: summary.T0 && summary.T2
        ? {
            totalScore: summary.T2.totalScore - summary.T0.totalScore,
            functionalLimitation: summary.T2.functionalLimitationScore - summary.T0.functionalLimitationScore,
            physicalPain: summary.T2.physicalPainScore - summary.T0.physicalPainScore,
            psychologicalDiscomfort: summary.T2.psychologicalDiscomfortScore - summary.T0.psychologicalDiscomfortScore,
            physicalDisability: summary.T2.physicalDisabilityScore - summary.T0.physicalDisabilityScore,
            psychologicalDisability: summary.T2.psychologicalDisabilityScore - summary.T0.psychologicalDisabilityScore,
            socialDisability: summary.T2.socialDisabilityScore - summary.T0.socialDisabilityScore,
            handicap: summary.T2.handicapScore - summary.T0.handicapScore,
          }
        : null,
    };

    return NextResponse.json({
      summary,
      changes,
    });
  } catch (error) {
    console.error('Error fetching OHIP-14 summary:', error);
    return NextResponse.json(
      { error: 'Hiba történt az összefoglaló lekérdezésekor' },
      { status: 500 }
    );
  }
}
