import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import type { PatientEpisode } from '@/lib/types';
import { logActivity } from '@/lib/activity';

const REASON_VALUES = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'];

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
    return NextResponse.json({ episodes });
  } catch (error) {
    console.error('Error fetching episodes:', error);
    return NextResponse.json(
      { error: 'Hiba történt az epizódok lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Create new episode (Új ellátási epizód indítása)
 * POST /api/patients/[id]/episodes
 * Body: { reason, chiefComplaint, caseTitle?, parentEpisodeId?, triggerType? }
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
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az epizód létrehozásához' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;

    const patientCheck = await pool.query(
      'SELECT id, kezelesre_erkezes_indoka as "reason" FROM patients WHERE id = $1',
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

    const body = await request.json();
    const reason = body.reason as string;
    const chiefComplaint = (body.chiefComplaint as string)?.trim?.();
    const caseTitle = (body.caseTitle as string)?.trim?.() || null;
    const parentEpisodeId = (body.parentEpisodeId as string) || null;
    const triggerType = body.triggerType as string || null;
    const treatmentTypeId = (body.treatmentTypeId as string)?.trim?.() || null;

    if (!reason || !REASON_VALUES.includes(reason)) {
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

    // MVP: egyszerre 1 open epizód — transaction + row lock to prevent concurrent duplicates
    const client = await pool.connect();
    let episode: PatientEpisode;
    try {
      await client.query('BEGIN');

      // Lock patient row to serialize concurrent episode creation for the same patient
      await client.query(
        `SELECT id FROM patients WHERE id = $1 FOR UPDATE`,
        [patientId]
      );

      const closingResult = await client.query(
        `SELECT id FROM patient_episodes WHERE patient_id = $1 AND status = 'open'`,
        [patientId]
      );
      const closingIds = closingResult.rows.map((r: { id: string }) => r.id);
      if (closingIds.length > 0) {
        try {
          const { invalidateIntentsForEpisodes } = await import('@/lib/intent-invalidation');
          await invalidateIntentsForEpisodes(closingIds, 'episode_closed');
        } catch (e) {
          console.error('Failed to invalidate intents for closed episodes:', e);
        }
      }
      await client.query(
        `UPDATE patient_episodes SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE patient_id = $1 AND status = 'open'`,
        [patientId]
      );

      // Kezelési út nincs automatikusan beállítva — csak a worklist „Kezelési út beállítása” vagy későbbi explicit választás állít be pathway-t. Így a kezelési terv idővonalban csak akkor jelennek meg, ha van beállítva.
      const insertResult = await client.query(
        `INSERT INTO patient_episodes (
          patient_id, reason, chief_complaint, case_title, status, opened_at, parent_episode_id, trigger_type, treatment_type_id, created_by
        ) VALUES ($1, $2, $3, $4, 'open', CURRENT_TIMESTAMP, $5, $6, $7, $8)
        RETURNING id`,
        [patientId, reason, chiefComplaint, caseTitle, parentEpisodeId, triggerType, treatmentTypeId || null, auth.email]
      );

      const newId = insertResult.rows[0]?.id;
      if (!newId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Epizód létrehozása sikertelen' }, { status: 500 });
      }

      const fetchResult = await client.query(
        `SELECT pe.id, pe.patient_id as "patientId", pe.reason, pe.pathway_code as "pathwayCode",
          pe.chief_complaint as "chiefComplaint", pe.case_title as "caseTitle", pe.status,
          pe.opened_at as "openedAt", pe.closed_at as "closedAt", pe.parent_episode_id as "parentEpisodeId",
          pe.trigger_type as "triggerType", pe.created_at as "createdAt", pe.created_by as "createdBy",
          pe.care_pathway_id as "carePathwayId", pe.assigned_provider_id as "assignedProviderId",
          pe.treatment_type_id as "treatmentTypeId", cp.name as "carePathwayName",
          COALESCE(u.doktor_neve, u.email) as "assignedProviderName",
          tt.code as "treatmentTypeCode", tt.label_hu as "treatmentTypeLabel"
         FROM patient_episodes pe
         LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
         LEFT JOIN users u ON pe.assigned_provider_id = u.id
         LEFT JOIN treatment_types tt ON pe.treatment_type_id = tt.id
         WHERE pe.id = $1`,
        [newId]
      );
      const row = fetchResult.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Epizód létrehozása sikertelen' }, { status: 500 });
      }
      episode = rowToEpisode(row);

      // Kezdő stage_event: STAGE_0
      const stageEventsExists = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`
      );
      if (stageEventsExists.rows.length > 0) {
        await client.query(
          `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, created_by) VALUES ($1, $2, 'STAGE_0', CURRENT_TIMESTAMP, $3)`,
          [patientId, episode.id, auth.email]
        );
      }

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    await logActivity(
      request,
      auth.email,
      'patient_episode_created',
      JSON.stringify({ patientId, episodeId: episode.id, reason })
    );

    return NextResponse.json({ episode }, { status: 201 });
  } catch (error) {
    console.error('Error creating episode:', error);
    return NextResponse.json(
      { error: 'Hiba történt az epizód létrehozásakor' },
      { status: 500 }
    );
  }
}
