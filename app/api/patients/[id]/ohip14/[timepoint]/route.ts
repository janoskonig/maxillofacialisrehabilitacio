import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { OHIP14Response, OHIP14Timepoint } from '@/lib/types';
import { calculateOHIP14Scores } from '@/lib/ohip14-questions';
import { getCurrentStageCodeForOhip, getCurrentEpisodeAndStage, isTimepointAllowedForStage } from '@/lib/ohip14-stage';
import { logActivity } from '@/lib/activity';
import { logger } from '@/lib/logger';

/**
 * Get patient's OHIP-14 response for a specific timepoint
 * GET /api/patients/[id]/ohip14/[timepoint]
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; timepoint: string } }
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
    const timepoint = params.timepoint as OHIP14Timepoint;

    if (!['T0', 'T1', 'T2', 'T3'].includes(timepoint)) {
      return NextResponse.json(
        { error: 'Érvénytelen timepoint' },
        { status: 400 }
      );
    }

    // Get response (prefer active episode, but allow episode_id in query)
    const searchParams = request.nextUrl.searchParams;
    const episodeId = searchParams.get('episodeId');

    let query = `
      SELECT 
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
      WHERE patient_id = $1 AND timepoint = $2
    `;

    const queryParams: any[] = [patientId, timepoint];

    if (episodeId) {
      query += ` AND episode_id = $3`;
      queryParams.push(episodeId);
    } else {
      const { episodeId: activeEpisodeId } = await getCurrentEpisodeAndStage(pool, patientId);
      if (activeEpisodeId) {
        query += ` AND episode_id = $3`;
        queryParams.push(activeEpisodeId);
      }
    }

    query += ` ORDER BY completed_at DESC LIMIT 1`;

    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return NextResponse.json({ response: null });
    }

    const response: OHIP14Response = mapRowToResponse(result.rows[0]);
    return NextResponse.json({ response });
  } catch (error) {
    logger.error('Error fetching OHIP-14 response:', error);
    return NextResponse.json(
      { error: 'Hiba történt a válasz lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Create or update patient's OHIP-14 response (admin/doctor)
 * POST /api/patients/[id]/ohip14/[timepoint]
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; timepoint: string } }
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
    const timepoint = params.timepoint as OHIP14Timepoint;

    if (!['T0', 'T1', 'T2', 'T3'].includes(timepoint)) {
      return NextResponse.json(
        { error: 'Érvénytelen timepoint' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const episodeIdParam = body.episodeId || null;

    let finalEpisodeId = episodeIdParam;
    const current = await getCurrentEpisodeAndStage(pool, patientId);

    if (!finalEpisodeId) {
      finalEpisodeId = current.episodeId;
      if (!finalEpisodeId) {
        return NextResponse.json(
          { error: 'Nincs aktív epizód. Kérjük, állítson be stádiumot.' },
          { status: 400 }
        );
      }
    }

    const stageCodeOrLegacy = current.useNewModel ? current.stageCode : current.stage;
    if (stageCodeOrLegacy && !isTimepointAllowedForStage(timepoint, stageCodeOrLegacy, current.useNewModel, current.deliveryDate)) {
      console.warn(
        `OHIP-14 timepoint ${timepoint} saved for patient ${patientId} in stage ${stageCodeOrLegacy}, which is not the typical stage for this timepoint`
      );
    }

    const stageCode = await getCurrentStageCodeForOhip(pool, patientId, finalEpisodeId);

    // Check if response already exists
    const existingResult = await pool.query(
      `SELECT id, locked_at 
       FROM ohip14_responses
       WHERE patient_id = $1
         AND timepoint = $2
         AND episode_id = $3`,
      [patientId, timepoint, finalEpisodeId]
    );

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
      const existing = existingResult.rows[0];
      if (existing.locked_at) {
        return NextResponse.json(
          { error: 'Ez a kérdőív le van zárva, nem módosítható' },
          { status: 403 }
        );
      }

      // Update existing
      const updateResult = await pool.query(
        `UPDATE ohip14_responses SET
          stage_code = $1,
          q1_functional_limitation = $2,
          q2_functional_limitation = $3,
          q3_physical_pain = $4,
          q4_physical_pain = $5,
          q5_psychological_discomfort = $6,
          q6_psychological_discomfort = $7,
          q7_physical_disability = $8,
          q8_physical_disability = $9,
          q9_psychological_disability = $10,
          q10_psychological_disability = $11,
          q11_social_disability = $12,
          q12_social_disability = $13,
          q13_handicap = $14,
          q14_handicap = $15,
          total_score = $16,
          functional_limitation_score = $17,
          physical_pain_score = $18,
          psychological_discomfort_score = $19,
          physical_disability_score = $20,
          psychological_disability_score = $21,
          social_disability_score = $22,
          handicap_score = $23,
          notes = $24,
          completed_at = CURRENT_TIMESTAMP,
          completed_by_patient = $25,
          updated_by = $26
        WHERE id = $27
        RETURNING *`,
        [
          stageCode ?? null,
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
          body.completedByPatient !== undefined ? body.completedByPatient : false,
          auth.email,
          existing.id,
        ]
      );

      await logActivity(
        request,
        auth.email,
        'ohip14_updated',
        JSON.stringify({ patientId, timepoint, episodeId: finalEpisodeId })
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
          stage_code,
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
        RETURNING *`,
        [
          patientId,
          finalEpisodeId,
          timepoint,
          stageCode ?? null,
          body.completedByPatient !== undefined ? body.completedByPatient : false,
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
          auth.email,
        ]
      );

      await logActivity(
        request,
        auth.email,
        'ohip14_created',
        JSON.stringify({ patientId, timepoint, episodeId: finalEpisodeId })
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
    logger.error('Error saving OHIP-14 response:', error);
    return NextResponse.json(
      { error: 'Hiba történt a válaszok mentésekor' },
      { status: 500 }
    );
  }
}

function mapRowToResponse(row: any): OHIP14Response {
  return {
    id: row.id,
    patientId: row.patient_id || row.patientId,
    episodeId: row.episode_id || row.episodeId,
    timepoint: row.timepoint,
    stageCode: row.stage_code ?? row.stageCode ?? null,
    completedAt: row.completed_at?.toISOString() || row.completedAt,
    completedByPatient: row.completed_by_patient !== undefined ? row.completed_by_patient : row.completedByPatient,
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
    totalScore: row.total_score || row.totalScore,
    functionalLimitationScore: row.functional_limitation_score || row.functionalLimitationScore,
    physicalPainScore: row.physical_pain_score || row.physicalPainScore,
    psychologicalDiscomfortScore: row.psychological_discomfort_score || row.psychologicalDiscomfortScore,
    physicalDisabilityScore: row.physical_disability_score || row.physicalDisabilityScore,
    psychologicalDisabilityScore: row.psychological_disability_score || row.psychologicalDisabilityScore,
    socialDisabilityScore: row.social_disability_score || row.socialDisabilityScore,
    handicapScore: row.handicap_score || row.handicapScore,
    notes: row.notes,
    lockedAt: row.locked_at?.toISOString() || row.lockedAt,
    createdAt: row.created_at?.toISOString() || row.createdAt,
    updatedAt: row.updated_at?.toISOString() || row.updatedAt,
    createdBy: row.created_by || row.createdBy,
    updatedBy: row.updated_by || row.updatedBy,
  };
}
