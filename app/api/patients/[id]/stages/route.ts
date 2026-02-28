import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { PatientStageEntry, PatientStageTimeline } from '@/lib/types';
import type { StageEventEntry, StageEventTimeline, PatientEpisode } from '@/lib/types';
import { logActivity } from '@/lib/activity';
import { logger } from '@/lib/logger';

/**
 * Get patient stages timeline
 * GET /api/patients/[id]/stages
 * Uses stage_events + patient_episodes when available, else patient_stages (legacy).
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

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

    const hasNewTables = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`
    );

    if (hasNewTables.rows.length > 0) {
      const eventsResult = await pool.query(
        `SELECT 
          se.id, se.patient_id as "patientId", se.episode_id as "episodeId",
          se.stage_code as "stageCode", se.at, se.note, se.created_by as "createdBy", se.created_at as "createdAt"
        FROM stage_events se
        WHERE se.patient_id = $1
        ORDER BY se.at DESC`,
        [patientId]
      );

      const events: StageEventEntry[] = eventsResult.rows.map((row) => ({
        id: row.id,
        patientId: row.patientId,
        episodeId: row.episodeId,
        stageCode: row.stageCode,
        at: (row.at as Date)?.toISOString?.() ?? String(row.at),
        note: row.note ?? null,
        createdBy: row.createdBy ?? null,
        createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
      }));

      if (events.length === 0) {
        // Új táblák léteznek, de ehhez a beteghez nincs stage_events → fallback legacy (lent)
      } else {
      const currentStage: StageEventEntry = events[0];

      const episodeIds = Array.from(new Set(events.map((e) => e.episodeId)));
      const episodesData = await pool.query(
        `SELECT id, patient_id as "patientId", reason, chief_complaint as "chiefComplaint", status, opened_at as "openedAt", closed_at as "closedAt"
         FROM patient_episodes WHERE id = ANY($1::uuid[])`,
        [episodeIds]
      );
      const episodeMap = new Map<string, PatientEpisode>();
      episodesData.rows.forEach((row) => {
        episodeMap.set(row.id, {
          id: row.id,
          patientId: row.patientId,
          reason: row.reason,
          chiefComplaint: row.chiefComplaint,
          status: row.status,
          openedAt: (row.openedAt as Date)?.toISOString?.() ?? String(row.openedAt),
          closedAt: row.closedAt ? (row.closedAt as Date)?.toISOString?.() ?? null : null,
        });
      });

      const episodesMap = new Map<string, StageEventEntry[]>();
      events.forEach((e) => {
        if (!episodesMap.has(e.episodeId)) episodesMap.set(e.episodeId, []);
        episodesMap.get(e.episodeId)!.push(e);
      });

      const episodes = Array.from(episodesMap.entries()).map(([episodeId, evs]) => {
        const sorted = [...evs].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
        return {
          episodeId,
          episode: episodeMap.get(episodeId) ?? undefined,
          startDate: sorted[0]?.at ?? new Date().toISOString(),
          endDate: sorted.length > 1 ? sorted[sorted.length - 1]?.at : undefined,
          stages: [...evs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
        };
      });

      const timeline: StageEventTimeline = {
        currentStage,
        history: events,
        episodes,
      };
      return NextResponse.json({ timeline, useNewModel: true });
      }
    }

    // Legacy: patient_stages
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

    const currentStage = stages.length > 0 ? stages[0] : null;
    const episodesMap = new Map<string, PatientStageEntry[]>();
    stages.forEach((stage) => {
      if (!episodesMap.has(stage.episodeId)) episodesMap.set(stage.episodeId, []);
      episodesMap.get(stage.episodeId)!.push(stage);
    });

    const episodes = Array.from(episodesMap.entries()).map(([episodeId, episodeStages]) => {
      const sortedStages = [...episodeStages].sort(
        (a, b) => (a.stageDate ? new Date(a.stageDate).getTime() : 0) - (b.stageDate ? new Date(b.stageDate).getTime() : 0)
      );
      return {
        episodeId,
        startDate: sortedStages[0]?.stageDate || new Date().toISOString(),
        endDate: sortedStages.length > 1 ? (sortedStages[sortedStages.length - 1]?.stageDate ?? undefined) : undefined,
        stages: [...episodeStages].sort(
          (a, b) => (b.stageDate ? new Date(b.stageDate).getTime() : 0) - (a.stageDate ? new Date(a.stageDate).getTime() : 0)
        ),
      };
    });

    const timeline: PatientStageTimeline = {
      currentStage,
      history: stages,
      episodes,
    };

  return NextResponse.json({ timeline });
});

/**
 * Create new patient stage
 * POST /api/patients/[id]/stages
 * New model: body { episodeId, stageCode, at?, note? }
 * Legacy: body { stage, notes?, stageDate?, startNewEpisode? }
 */
export const POST = roleHandler(['admin', 'sebészorvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

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

    const hasStageEvents = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`
    );

    const body = await req.json();

    if (hasStageEvents.rows.length > 0 && (body.episodeId != null || body.stageCode != null)) {
      const episodeId = body.episodeId as string;
      const stageCode = (body.stageCode as string)?.trim?.();
      const at = body.at ? new Date(body.at) : new Date();
      const note = (body.note as string)?.trim?.() || null;

      if (!episodeId || !stageCode) {
        return NextResponse.json(
          { error: 'episodeId és stageCode kötelező (új modell)' },
          { status: 400 }
        );
      }

      const episodeRow = await pool.query(
        `SELECT id, patient_id, reason, status FROM patient_episodes WHERE id = $1 AND patient_id = $2`,
        [episodeId, patientId]
      );
      if (episodeRow.rows.length === 0) {
        return NextResponse.json(
          { error: 'Epizód nem található vagy nem ehhez a beteghez tartozik' },
          { status: 404 }
        );
      }
      if (episodeRow.rows[0].status !== 'open') {
        return NextResponse.json(
          { error: 'Csak aktív (open) epizódhoz lehet új stádiumot rögzíteni' },
          { status: 400 }
        );
      }

      const reason = episodeRow.rows[0].reason;
      const catalogCheck = await pool.query(
        `SELECT 1 FROM stage_catalog WHERE code = $1 AND reason = $2`,
        [stageCode, reason]
      );
      if (catalogCheck.rows.length === 0) {
        return NextResponse.json(
          { error: `Érvénytelen stádium kód (${stageCode}) az adott etiológiához` },
          { status: 400 }
        );
      }

      const insertResult = await pool.query(
        `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, patient_id as "patientId", episode_id as "episodeId", stage_code as "stageCode", at, note, created_by as "createdBy", created_at as "createdAt"`,
        [patientId, episodeId, stageCode, at, note, auth.email]
      );

      const row = insertResult.rows[0];
      const newStage: StageEventEntry = {
        id: row.id,
        patientId: row.patientId,
        episodeId: row.episodeId,
        stageCode: row.stageCode,
        at: (row.at as Date)?.toISOString?.() ?? new Date().toISOString(),
        note: row.note ?? null,
        createdBy: row.createdBy ?? null,
        createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
      };

      await logActivity(
        req,
        auth.email,
        'patient_stage_created',
        JSON.stringify({ patientId, stageCode, episodeId })
      );

      if (stageCode === 'STAGE_6') {
        try {
          const { ensureRecallTasksForEpisode } = await import('@/lib/recall-tasks');
          await ensureRecallTasksForEpisode(episodeId);
        } catch (e) {
          logger.error('Failed to create recall tasks:', e);
        }
      }

      return NextResponse.json({ stage: newStage, useNewModel: true }, { status: 201 });
    }

    // Legacy: patient_stages
    const { stage, notes, stageDate, startNewEpisode } = body;

    if (!stage) {
      return NextResponse.json(
        { error: 'Stádium megadása kötelező' },
        { status: 400 }
      );
    }

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

    let episodeId: string;

    if (startNewEpisode || stage === 'uj_beteg') {
      const newEpisodeResult = await pool.query('SELECT generate_uuid() as id');
      episodeId = newEpisodeResult.rows[0].id;
    } else {
      const currentStageResult = await pool.query(
        `SELECT episode_id FROM patient_current_stage WHERE patient_id = $1`,
        [patientId]
      );

      if (currentStageResult.rows.length > 0) {
        episodeId = currentStageResult.rows[0].episode_id;
      } else {
        const newEpisodeResult = await pool.query('SELECT generate_uuid() as id');
        episodeId = newEpisodeResult.rows[0].id;
      }
    }

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

    await logActivity(
      req,
      auth.email,
      'patient_stage_created',
      JSON.stringify({ patientId, stage, episodeId })
    );

    return NextResponse.json({ stage: newStage }, { status: 201 });
});
