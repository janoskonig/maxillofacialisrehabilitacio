import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { PatientStageEntry } from '@/lib/types';
import { logActivity } from '@/lib/activity';

/**
 * Start new episode for patient
 * POST /api/patients/[id]/stages/new-episode
 */
export const dynamic = 'force-dynamic';

export async function POST(
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

    // Only admin and doctors can start new episodes
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága új epizód indításához' },
        { status: 403 }
      );
    }

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

    const body = await request.json();
    const { stage, notes, stageDate } = body;

    // Default to 'uj_beteg' if not specified
    const newStage = stage || 'uj_beteg';

    // Validate stage
    const validStages = [
      'uj_beteg',
      'onkologiai_kezeles_kesz',
      'arajanlatra_var',
      'implantacios_sebeszi_tervezesre_var',
      'fogpotlasra_var',
      'fogpotlas_keszul',
      'fogpotlas_kesz',
      'gondozas_alatt',
    ];

    if (!validStages.includes(newStage)) {
      return NextResponse.json(
        { error: 'Érvénytelen stádium' },
        { status: 400 }
      );
    }

    // Generate new episode_id
    const newEpisodeResult = await pool.query('SELECT generate_uuid() as id');
    const episodeId = newEpisodeResult.rows[0].id;

    // Insert new stage with new episode
    const insertResult = await pool.query(
      `INSERT INTO patient_stages (
        patient_id,
        episode_id,
        stage,
        stage_date,
        notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id,
        patient_id as "patientId",
        episode_id as "episodeId",
        stage,
        stage_date as "stageDate",
        notes,
        created_at as "createdAt",
        created_by as "createdBy"`,
      [
        patientId,
        episodeId,
        newStage,
        stageDate ? new Date(stageDate) : new Date(),
        notes || null,
        auth.email,
      ]
    );

    const stageEntry: PatientStageEntry = {
      id: insertResult.rows[0].id,
      patientId: insertResult.rows[0].patientId,
      episodeId: insertResult.rows[0].episodeId,
      stage: insertResult.rows[0].stage,
      stageDate: insertResult.rows[0].stageDate.toISOString(),
      notes: insertResult.rows[0].notes,
      createdAt: insertResult.rows[0].createdAt.toISOString(),
      createdBy: insertResult.rows[0].createdBy,
    };

    // Log activity
    await logActivity(
      request,
      auth.email,
      'patient_episode_started',
      JSON.stringify({ patientId, episodeId, stage: newStage })
    );

    return NextResponse.json({ 
      stage: stageEntry,
      episodeId,
      message: 'Új epizód sikeresen elindítva'
    }, { status: 201 });
  } catch (error) {
    console.error('Error starting new episode:', error);
    return NextResponse.json(
      { error: 'Hiba történt az új epizód indításakor' },
      { status: 500 }
    );
  }
}
