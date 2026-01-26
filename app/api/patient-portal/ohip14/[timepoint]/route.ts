import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { OHIP14Response, OHIP14Timepoint } from '@/lib/types';
import { calculateOHIP14Scores } from '@/lib/ohip14-questions';

/**
 * Get patient's OHIP-14 response for a specific timepoint
 * GET /api/patient-portal/ohip14/[timepoint]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { timepoint: string } }
) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const timepoint = params.timepoint as OHIP14Timepoint;
    if (!['T0', 'T1', 'T2'].includes(timepoint)) {
      return NextResponse.json(
        { error: 'Érvénytelen timepoint' },
        { status: 400 }
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

    // Get response for this timepoint
    const result = await pool.query(
      `SELECT 
        id,
        patient_id as "patientId",
        episode_id as "episodeId",
        timepoint,
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
        AND timepoint = $2
        AND (episode_id = $3 OR episode_id IS NULL OR $3 IS NULL)
      ORDER BY completed_at DESC
      LIMIT 1`,
      [patientId, timepoint, activeEpisodeId]
    );

    if (result.rows.length === 0) {
      // Return empty response object
      return NextResponse.json({
        response: {
          patientId,
          episodeId: activeEpisodeId,
          timepoint,
          completedByPatient: true,
          q1_functional_limitation: null,
          q2_functional_limitation: null,
          q3_physical_pain: null,
          q4_physical_pain: null,
          q5_psychological_discomfort: null,
          q6_psychological_discomfort: null,
          q7_physical_disability: null,
          q8_physical_disability: null,
          q9_psychological_disability: null,
          q10_psychological_disability: null,
          q11_social_disability: null,
          q12_social_disability: null,
          q13_handicap: null,
          q14_handicap: null,
        },
      });
    }

    const row = result.rows[0];
    const response: OHIP14Response = {
      id: row.id,
      patientId: row.patientId,
      episodeId: row.episodeId,
      timepoint: row.timepoint,
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
    };

    return NextResponse.json({ response });
  } catch (error) {
    console.error('Error fetching OHIP-14 response:', error);
    return NextResponse.json(
      { error: 'Hiba történt a válasz lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Create or update patient's OHIP-14 response for a specific timepoint
 * POST /api/patient-portal/ohip14/[timepoint]
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { timepoint: string } }
) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const timepoint = params.timepoint as OHIP14Timepoint;
    if (!['T0', 'T1', 'T2'].includes(timepoint)) {
      return NextResponse.json(
        { error: 'Érvénytelen timepoint' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    const body = await request.json();

    // Get current active episode and stage
    const currentStageResult = await pool.query(
      `SELECT episode_id, stage
       FROM patient_current_stage 
       WHERE patient_id = $1`,
      [patientId]
    );

    const activeEpisodeId = currentStageResult.rows.length > 0 
      ? currentStageResult.rows[0].episode_id 
      : null;
    const currentStage = currentStageResult.rows.length > 0
      ? currentStageResult.rows[0].stage
      : null;

    if (!activeEpisodeId) {
      return NextResponse.json(
        { error: 'Nincs aktív epizód. Kérjük, állítson be stádiumot.' },
        { status: 400 }
      );
    }

    // Validate stage for timepoint
    const timepointStageMap: Record<OHIP14Timepoint, string> = {
      T0: 'uj_beteg',
      T1: 'onkologiai_kezeles_kesz',
      T2: 'gondozas_alatt',
    };

    const requiredStage = timepointStageMap[timepoint];
    if (currentStage !== requiredStage) {
      return NextResponse.json(
        { 
          error: `Ez a timepoint csak "${requiredStage === 'uj_beteg' ? 'Új beteg' : requiredStage === 'onkologiai_kezeles_kesz' ? 'Onkológiai kezelés kész' : 'Gondozás alatt'}" stádiumban kitölthető. Jelenlegi stádium: ${currentStage || 'Nincs'}.` 
        },
        { status: 403 }
      );
    }

    // Check if response already exists
    const existingResult = await pool.query(
      `SELECT id, locked_at 
       FROM ohip14_responses
       WHERE patient_id = $1
         AND timepoint = $2
         AND episode_id = $3`,
      [patientId, timepoint, activeEpisodeId]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      if (existing.locked_at) {
        return NextResponse.json(
          { error: 'Ez a kérdőív le van zárva, nem módosítható' },
          { status: 403 }
        );
      }
    }

    // Calculate scores
    const scores = calculateOHIP14Scores(body);

    // Validate all questions are answered
    const requiredFields = [
      'q1_functional_limitation',
      'q2_functional_limitation',
      'q3_physical_pain',
      'q4_physical_pain',
      'q5_psychological_discomfort',
      'q6_psychological_discomfort',
      'q7_physical_disability',
      'q8_physical_disability',
      'q9_psychological_disability',
      'q10_psychological_disability',
      'q11_social_disability',
      'q12_social_disability',
      'q13_handicap',
      'q14_handicap',
    ];

    for (const field of requiredFields) {
      const value = body[field];
      if (value === null || value === undefined) {
        return NextResponse.json(
          { error: `Kérjük, válaszoljon minden kérdésre. Hiányzó: ${field}` },
          { status: 400 }
        );
      }
      if (value < 0 || value > 4) {
        return NextResponse.json(
          { error: `Érvénytelen érték: ${field}` },
          { status: 400 }
        );
      }
    }

    if (existingResult.rows.length > 0) {
      // Update existing
      const updateResult = await pool.query(
        `UPDATE ohip14_responses SET
          q1_functional_limitation = $1,
          q2_functional_limitation = $2,
          q3_physical_pain = $3,
          q4_physical_pain = $4,
          q5_psychological_discomfort = $5,
          q6_psychological_discomfort = $6,
          q7_physical_disability = $7,
          q8_physical_disability = $8,
          q9_psychological_disability = $9,
          q10_psychological_disability = $10,
          q11_social_disability = $11,
          q12_social_disability = $12,
          q13_handicap = $13,
          q14_handicap = $14,
          total_score = $15,
          functional_limitation_score = $16,
          physical_pain_score = $17,
          psychological_discomfort_score = $18,
          physical_disability_score = $19,
          psychological_disability_score = $20,
          social_disability_score = $21,
          handicap_score = $22,
          notes = $23,
          completed_at = CURRENT_TIMESTAMP,
          updated_by = 'patient_portal'
        WHERE id = $24
        RETURNING *`,
        [
          body.q1_functional_limitation,
          body.q2_functional_limitation,
          body.q3_physical_pain,
          body.q4_physical_pain,
          body.q5_psychological_discomfort,
          body.q6_psychological_discomfort,
          body.q7_physical_disability,
          body.q8_physical_disability,
          body.q9_psychological_disability,
          body.q10_psychological_disability,
          body.q11_social_disability,
          body.q12_social_disability,
          body.q13_handicap,
          body.q14_handicap,
          scores.totalScore,
          scores.functionalLimitationScore,
          scores.physicalPainScore,
          scores.psychologicalDiscomfortScore,
          scores.physicalDisabilityScore,
          scores.psychologicalDisabilityScore,
          scores.socialDisabilityScore,
          scores.handicapScore,
          body.notes || null,
          existingResult.rows[0].id,
        ]
      );

      return NextResponse.json({
        response: mapRowToResponse(updateResult.rows[0]),
        message: 'Válaszok sikeresen frissítve',
      });
    } else {
      // Create new
      const insertResult = await pool.query(
        `INSERT INTO ohip14_responses (
          patient_id,
          episode_id,
          timepoint,
          completed_by_patient,
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
          total_score,
          functional_limitation_score,
          physical_pain_score,
          psychological_discomfort_score,
          physical_disability_score,
          psychological_disability_score,
          social_disability_score,
          handicap_score,
          notes,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, 'patient_portal')
        RETURNING *`,
        [
          patientId,
          activeEpisodeId,
          timepoint,
          true,
          body.q1_functional_limitation,
          body.q2_functional_limitation,
          body.q3_physical_pain,
          body.q4_physical_pain,
          body.q5_psychological_discomfort,
          body.q6_psychological_discomfort,
          body.q7_physical_disability,
          body.q8_physical_disability,
          body.q9_psychological_disability,
          body.q10_psychological_disability,
          body.q11_social_disability,
          body.q12_social_disability,
          body.q13_handicap,
          body.q14_handicap,
          scores.totalScore,
          scores.functionalLimitationScore,
          scores.physicalPainScore,
          scores.psychologicalDiscomfortScore,
          scores.physicalDisabilityScore,
          scores.psychologicalDisabilityScore,
          scores.socialDisabilityScore,
          scores.handicapScore,
          body.notes || null,
        ]
      );

      return NextResponse.json(
        {
          response: mapRowToResponse(insertResult.rows[0]),
          message: 'Válaszok sikeresen mentve',
        },
        { status: 201 }
      );
    }
  } catch (error) {
    console.error('Error saving OHIP-14 response:', error);
    return NextResponse.json(
      { error: 'Hiba történt a válaszok mentésekor' },
      { status: 500 }
    );
  }
}

/**
 * Update patient's OHIP-14 response (PUT for updates)
 * PUT /api/patient-portal/ohip14/[timepoint]
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { timepoint: string } }
) {
  // Same as POST, but for semantic clarity
  return POST(request, { params });
}

function mapRowToResponse(row: any): OHIP14Response {
  return {
    id: row.id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    timepoint: row.timepoint,
    completedAt: row.completed_at?.toISOString(),
    completedByPatient: row.completed_by_patient,
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
    totalScore: row.total_score,
    functionalLimitationScore: row.functional_limitation_score,
    physicalPainScore: row.physical_pain_score,
    psychologicalDiscomfortScore: row.psychological_discomfort_score,
    physicalDisabilityScore: row.physical_disability_score,
    psychologicalDisabilityScore: row.psychological_disability_score,
    socialDisabilityScore: row.social_disability_score,
    handicapScore: row.handicap_score,
    notes: row.notes,
    lockedAt: row.locked_at?.toISOString(),
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString(),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}
