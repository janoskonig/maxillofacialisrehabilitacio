import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { OHIP14Response } from '@/lib/types';

/**
 * Get patient's OHIP-14 responses
 * GET /api/patients/[id]/ohip14
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  // Check if patient exists
  const patientCheck = await pool.query(
    'SELECT id FROM patients WHERE id = $1',
    [patientId]
  );

  if (patientCheck.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  // Get all responses for this patient
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
    ORDER BY timepoint, completed_at DESC`,
    [patientId]
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
});
