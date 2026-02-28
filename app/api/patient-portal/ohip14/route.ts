import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { getCurrentEpisodeAndStage } from '@/lib/ohip14-stage';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const pool = getDbPool();
  const { episodeId: activeEpisodeId } = await getCurrentEpisodeAndStage(pool, patientId);

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

  const responses = result.rows.map((row) => ({
    timepoint: row.timepoint,
    completedAt: row.completedAt?.toISOString(),
    completed: true as const,
  }));

  return NextResponse.json({ responses });
});
