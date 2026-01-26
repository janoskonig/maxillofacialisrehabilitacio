import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { patientStageSchema, PatientStageEntry, PatientStageTimeline } from '@/lib/types';
import { logActivity } from '@/lib/activity';

/**
 * Get patient stages timeline
 * GET /api/patients/[id]/stages
 */
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

    // Get all stages for this patient, ordered by date descending
    const stagesResult = await pool.query(
      `SELECT 
        id,
        patient_id as "patientId",
        episode_id as "episodeId",
        stage,
        stage_date as "stageDate",
        notes,
        created_at as "createdAt",
        created_by as "createdBy"
      FROM patient_stages
      WHERE patient_id = $1
      ORDER BY stage_date DESC`,
      [patientId]
    );

    const stages: PatientStageEntry[] = stagesResult.rows.map((row) => ({
      id: row.id,
      patientId: row.patientId,
      episodeId: row.episodeId,
      stage: row.stage,
      stageDate: row.stageDate?.toISOString() || new Date().toISOString(),
      notes: row.notes,
      createdAt: row.createdAt?.toISOString(),
      createdBy: row.createdBy,
    }));

    // Get current stage (most recent)
    const currentStage = stages.length > 0 ? stages[0] : null;

    // Group stages by episode
    const episodesMap = new Map<string, PatientStageEntry[]>();
    stages.forEach((stage) => {
      if (!episodesMap.has(stage.episodeId)) {
        episodesMap.set(stage.episodeId, []);
      }
      episodesMap.get(stage.episodeId)!.push(stage);
    });

    // Build episodes array
    const episodes = Array.from(episodesMap.entries()).map(([episodeId, episodeStages]) => {
      const sortedStages = episodeStages.sort(
        (a, b) => {
          const dateA = a.stageDate ? new Date(a.stageDate).getTime() : 0;
          const dateB = b.stageDate ? new Date(b.stageDate).getTime() : 0;
          return dateA - dateB;
        }
      );
      return {
        episodeId,
        startDate: sortedStages[0]?.stageDate || new Date().toISOString(),
        endDate: sortedStages.length > 1 ? (sortedStages[sortedStages.length - 1]?.stageDate ?? undefined) : undefined,
        stages: episodeStages.sort(
          (a, b) => {
            const dateA = a.stageDate ? new Date(a.stageDate).getTime() : 0;
            const dateB = b.stageDate ? new Date(b.stageDate).getTime() : 0;
            return dateB - dateA;
          }
        ),
      };
    });

    const timeline: PatientStageTimeline = {
      currentStage,
      history: stages,
      episodes,
    };

    return NextResponse.json({ timeline });
  } catch (error) {
    console.error('Error fetching patient stages:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stádiumok lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Create new patient stage
 * POST /api/patients/[id]/stages
 */
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

    // Only admin and doctors can set stages
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a stádium beállításához' },
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
    const { stage, notes, stageDate, startNewEpisode } = body;

    if (!stage) {
      return NextResponse.json(
        { error: 'Stádium megadása kötelező' },
        { status: 400 }
      );
    }

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

    if (!validStages.includes(stage)) {
      return NextResponse.json(
        { error: 'Érvénytelen stádium' },
        { status: 400 }
      );
    }

    // Determine episode_id
    let episodeId: string;

    if (startNewEpisode || stage === 'uj_beteg') {
      // Start new episode - generate new episode_id
      const newEpisodeResult = await pool.query('SELECT generate_uuid() as id');
      episodeId = newEpisodeResult.rows[0].id;
    } else {
      // Use current active episode
      const currentStageResult = await pool.query(
        `SELECT episode_id 
         FROM patient_current_stage 
         WHERE patient_id = $1`,
        [patientId]
      );

      if (currentStageResult.rows.length > 0) {
        episodeId = currentStageResult.rows[0].episode_id;
      } else {
        // No current stage, start new episode
        const newEpisodeResult = await pool.query('SELECT generate_uuid() as id');
        episodeId = newEpisodeResult.rows[0].id;
      }
    }

    // Insert new stage
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
        stage,
        stageDate ? new Date(stageDate) : new Date(),
        notes || null,
        auth.email,
      ]
    );

    const newStage: PatientStageEntry = {
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
      'patient_stage_created',
      JSON.stringify({ patientId, stage, episodeId })
    );

    return NextResponse.json({ stage: newStage }, { status: 201 });
  } catch (error) {
    console.error('Error creating patient stage:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stádium létrehozásakor' },
      { status: 500 }
    );
  }
}
