import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import type { PatientEpisode } from '@/lib/types';
import { logActivity } from '@/lib/activity';
import { createOpenEpisodeWithInitialStageZero, EPISODE_REASON_VALUES } from '@/lib/patient-episode-create';

const REASON_VALUES = [...EPISODE_REASON_VALUES];
const REASON_SET = new Set<string>(REASON_VALUES);

function rowToEpisode(row: Record<string, unknown>): PatientEpisode {
  return {
    id: row.id as string,
    patientId: row.patientId as string,
    reason: row.reason as PatientEpisode['reason'],
    pathwayCode: (row.pathwayCode as string) || null,
    chiefComplaint: row.chiefComplaint as string,
    caseTitle: (row.caseTitle as string) || null,
    status: row.status as PatientEpisode['status'],
    openedAt: (row.openedAt as Date)?.toISOString?.() ?? String(row.openedAt),
    closedAt: (row.closedAt as Date)?.toISOString?.() ?? (row.closedAt as string) ?? null,
    parentEpisodeId: (row.parentEpisodeId as string) || null,
    triggerType: (row.triggerType as PatientEpisode['triggerType']) || null,
    createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
    createdBy: (row.createdBy as string) || null,
    carePathwayId: (row.carePathwayId as string) || null,
    assignedProviderId: (row.assignedProviderId as string) || null,
    carePathwayName: (row.carePathwayName as string) || null,
    assignedProviderName: (row.assignedProviderName as string) || null,
    treatmentTypeId: (row.treatmentTypeId as string) || null,
    treatmentTypeCode: (row.treatmentTypeCode as string) || null,
    treatmentTypeLabel: (row.treatmentTypeLabel as string) || null,
  };
}

/**
 * Get all episodes for a patient
 * GET /api/patients/[id]/episodes
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_episodes'`
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ episodes: [] });
  }

  const result = await pool.query(
    `SELECT 
      pe.id,
      pe.patient_id as "patientId",
      pe.reason,
      pe.pathway_code as "pathwayCode",
      pe.chief_complaint as "chiefComplaint",
      pe.case_title as "caseTitle",
      pe.status,
      pe.opened_at as "openedAt",
      pe.closed_at as "closedAt",
      pe.parent_episode_id as "parentEpisodeId",
      pe.trigger_type as "triggerType",
      pe.created_at as "createdAt",
      pe.created_by as "createdBy",
      pe.care_pathway_id as "carePathwayId",
      pe.assigned_provider_id as "assignedProviderId",
      pe.treatment_type_id as "treatmentTypeId",
      cp.name as "carePathwayName",
      COALESCE(u.doktor_neve, u.email) as "assignedProviderName",
      tt.code as "treatmentTypeCode",
      tt.label_hu as "treatmentTypeLabel"
    FROM patient_episodes pe
    LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
    LEFT JOIN users u ON pe.assigned_provider_id = u.id
    LEFT JOIN treatment_types tt ON pe.treatment_type_id = tt.id
    WHERE pe.patient_id = $1
    ORDER BY pe.opened_at DESC`,
    [patientId]
  );

  const episodes: PatientEpisode[] = result.rows.map(rowToEpisode);

  // Enrich with episodePathways (multi-pathway support)
  try {
    const episodeIds = episodes.map((e) => e.id);
    if (episodeIds.length > 0) {
      const epPathRows = await pool.query(
        `SELECT ep.id, ep.episode_id, ep.care_pathway_id as "carePathwayId", ep.ordinal,
                ep.jaw, cp.name as "pathwayName",
                (SELECT COUNT(*)::int FROM episode_work_phases ewp WHERE ewp.source_episode_pathway_id = ep.id) as "stepCount"
         FROM episode_pathways ep
         JOIN care_pathways cp ON ep.care_pathway_id = cp.id
         WHERE ep.episode_id = ANY($1)
         ORDER BY ep.ordinal`,
        [episodeIds]
      );
      const byEpisode = new Map<string, typeof epPathRows.rows>();
      for (const row of epPathRows.rows) {
        const arr = byEpisode.get(row.episode_id) ?? [];
        arr.push(row);
        byEpisode.set(row.episode_id, arr);
      }
      for (const ep of episodes) {
        ep.episodePathways = (byEpisode.get(ep.id) ?? []).map((r: Record<string, unknown>) => ({
          id: r.id as string,
          carePathwayId: r.carePathwayId as string,
          ordinal: r.ordinal as number,
          pathwayName: r.pathwayName as string,
          stepCount: r.stepCount as number,
          jaw: (r.jaw as "felso" | "also" | null) || null,
        }));
      }
    }
  } catch {
    // episode_pathways table might not exist yet (pre-migration)
  }

  return NextResponse.json({ episodes });
});

/**
 * Create new episode (Új ellátási epizód indítása)
 * POST /api/patients/[id]/episodes
 * Body: { reason, chiefComplaint, caseTitle?, parentEpisodeId?, triggerType? }
 */
export const POST = roleHandler(
  ['admin', 'beutalo_orvos', 'fogpótlástanász'],
  async (req, { auth, params }) => {
    const pool = getDbPool();
    const patientId = params.id;

    const patientCheck = await pool.query(
      `SELECT p.id, a.kezelesre_erkezes_indoka as "reason"
       FROM patients p
       LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
       WHERE p.id = $1`,
      [patientId]
    );
    if (patientCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
    }

    const tableExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_episodes'`
    );
    if (tableExists.rows.length === 0) {
      return NextResponse.json(
        { error: 'patient_episodes tábla nem létezik – futtasd a migrációt' },
        { status: 503 }
      );
    }

    const body = await req.json();
    const reason = body.reason as string;
    const chiefComplaint = (body.chiefComplaint as string)?.trim?.();
    const caseTitle = (body.caseTitle as string)?.trim?.() || null;
    const parentEpisodeId = (body.parentEpisodeId as string) || null;
    const triggerType = body.triggerType as string || null;
    const treatmentTypeId = (body.treatmentTypeId as string)?.trim?.() || null;

    if (!reason || !REASON_SET.has(reason)) {
      return NextResponse.json(
        { error: 'Érvényes etiológia (reason) kötelező' },
        { status: 400 }
      );
    }
    if (!chiefComplaint) {
      return NextResponse.json(
        { error: 'Cím / ok (chiefComplaint) kötelező' },
        { status: 400 }
      );
    }

    let episode: PatientEpisode;
    try {
      episode = await createOpenEpisodeWithInitialStageZero(pool, {
        patientId,
        reason,
        chiefComplaint,
        caseTitle,
        parentEpisodeId,
        triggerType,
        treatmentTypeId,
        createdBy: auth.email,
      });
    } catch {
      return NextResponse.json({ error: 'Epizód létrehozása sikertelen' }, { status: 500 });
    }

    await logActivity(
      req,
      auth.email,
      'patient_episode_created',
      JSON.stringify({ patientId, episodeId: episode.id, reason })
    );

    return NextResponse.json({ episode }, { status: 201 });
  }
);
