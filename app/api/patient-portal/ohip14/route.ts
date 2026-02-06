import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { OHIP14Response } from '@/lib/types';
import { calculateOHIP14Scores } from '@/lib/ohip14-questions';

/**
 * Get patient's OHIP-14 responses
 * GET /api/patient-portal/ohip14
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Get current active episode
    const currentStageResult = await pool.query(
      `SELECT episode_id 
       FROM patient_current_stage 
       WHERE patient_id = $1`,
      [patientId]
    );

    const activeEpisodeId = currentStageResult.rows.length > 0 
      ? currentStageResult.rows[0].episode_id 
      : null;

    // Get all responses for this patient (prefer active episode, but include all)
    const result = await pool.query(
      `SELECT 
        id,
        patient_id as "patientId",
        episode_id as "episodeId",
        timepoint,
        stage_code as "stageCode",
        completed_at as "completedAt",
        completed_by_patient as "completedByPatient",
        q1_functional_limitation,
        q2_functional_limitation,
        q3_physical_pain,
        q4_physical_pain,
        q5_psychological_discomfort,
        q6_psychological_discomfort,
        q7_physical_disability,
        q8_physical_disability,
        q9_psychological_disability,
        q10_psychological_disability,
        q11_social_disability,
        q12_social_disability,
        q13_handicap,
        q14_handicap,
        total_score as "totalScore",
        functional_limitation_score as "functionalLimitationScore",
        physical_pain_score as "physicalPainScore",
        psychological_discomfort_score as "psychologicalDiscomfortScore",
        physical_disability_score as "physicalDisabilityScore",
        psychological_disability_score as "psychologicalDisabilityScore",
        social_disability_score as "socialDisabilityScore",
        handicap_score as "handicapScore",
        notes,
        locked_at as "lockedAt",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy",
        updated_by as "updatedBy"
      FROM ohip14_responses
      WHERE patient_id = $1
        AND (episode_id = $2 OR episode_id IS NULL OR $2 IS NULL)
      ORDER BY timepoint, completed_at DESC`,
      [patientId, activeEpisodeId]
    );

    const responses: OHIP14Response[] = result.rows.map((row) => ({
      id: row.id,
      patientId: row.patientId,
      episodeId: row.episodeId,
      timepoint: row.timepoint,
      stageCode: row.stageCode ?? null,
      completedAt: row.completedAt?.toISOString(),
      completedByPatient: row.completedByPatient,
      q1_functional_limitation: row.q1_functional_limitation,
      q2_functional_limitation: row.q2_functional_limitation,
      q3_physical_pain: row.q3_physical_pain,
      q4_physical_pain: row.q4_physical_pain,
      q5_psychological_discomfort: row.q5_psychological_discomfort,
      q6_psychological_discomfort: row.q6_psychological_discomfort,
      q7_physical_disability: row.q7_physical_disability,
      q8_physical_disability: row.q8_physical_disability,
      q9_psychological_disability: row.q9_psychological_disability,
      q10_psychological_disability: row.q10_psychological_disability,
      q11_social_disability: row.q11_social_disability,
      q12_social_disability: row.q12_social_disability,
      q13_handicap: row.q13_handicap,
      q14_handicap: row.q14_handicap,
      totalScore: row.totalScore,
      functionalLimitationScore: row.functionalLimitationScore,
      physicalPainScore: row.physicalPainScore,
      psychologicalDiscomfortScore: row.psychologicalDiscomfortScore,
      physicalDisabilityScore: row.physicalDisabilityScore,
      psychologicalDisabilityScore: row.psychologicalDisabilityScore,
      socialDisabilityScore: row.socialDisabilityScore,
      handicapScore: row.handicapScore,
      notes: row.notes,
      lockedAt: row.lockedAt?.toISOString(),
      createdAt: row.createdAt?.toISOString(),
      updatedAt: row.updatedAt?.toISOString(),
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    }));

    return NextResponse.json({ responses });
  } catch (error) {
    console.error('Error fetching OHIP-14 responses:', error);
    return NextResponse.json(
      { error: 'Hiba történt a válaszok lekérdezésekor' },
      { status: 500 }
    );
  }
}
