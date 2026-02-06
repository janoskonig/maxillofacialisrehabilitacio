import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import type { PatientMilestoneEntry } from '@/lib/types';

function rowToMilestone(row: Record<string, unknown>): PatientMilestoneEntry {
  return {
    id: row.id as string,
    patientId: row.patientId as string,
    episodeId: row.episodeId as string,
    code: row.code as string,
    at: (row.at as Date)?.toISOString?.() ?? String(row.at),
    params: (row.params as Record<string, unknown>) ?? null,
    note: (row.note as string) ?? null,
    createdBy: (row.createdBy as string) ?? null,
    createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
  };
}

/**
 * Get milestones for a patient, optionally filtered by episode
 * GET /api/patients/[id]/milestones?episodeId=...
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
    const episodeId = request.nextUrl.searchParams.get('episodeId');

    const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
    if (patientCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
    }

    const tableExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_milestones'`
    );
    if (tableExists.rows.length === 0) {
      return NextResponse.json({ milestones: [] });
    }

    let query = `
      SELECT id, patient_id as "patientId", episode_id as "episodeId", code, at, params, note, created_by as "createdBy", created_at as "createdAt"
      FROM patient_milestones
      WHERE patient_id = $1
    `;
    const queryParams: string[] = [patientId];
    if (episodeId) {
      query += ` AND episode_id = $2`;
      queryParams.push(episodeId);
    }
    query += ` ORDER BY at DESC`;

    const result = await pool.query(query, queryParams);
    const milestones: PatientMilestoneEntry[] = result.rows.map(rowToMilestone);
    return NextResponse.json({ milestones });
  } catch (error) {
    console.error('Error fetching milestones:', error);
    return NextResponse.json(
      { error: 'Hiba történt a milestone-ok lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Create new milestone
 * POST /api/patients/[id]/milestones
 * Body: { episodeId, code, at?, params?, note? }
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
        { error: 'Nincs jogosultsága a milestone rögzítéséhez' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;

    const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
    if (patientCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
    }

    const tableExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_milestones'`
    );
    if (tableExists.rows.length === 0) {
      return NextResponse.json(
        { error: 'patient_milestones tábla nem létezik – futtasd a migrációt' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const episodeId = body.episodeId as string;
    const code = (body.code as string)?.trim?.();
    const at = body.at ? new Date(body.at) : new Date();
    const milestoneParams = body.params && typeof body.params === 'object' ? body.params : null;
    const note = (body.note as string)?.trim?.() || null;

    if (!episodeId || !code) {
      return NextResponse.json(
        { error: 'episodeId és code kötelező' },
        { status: 400 }
      );
    }

    const episodeRow = await pool.query(
      `SELECT id, patient_id, status FROM patient_episodes WHERE id = $1 AND patient_id = $2`,
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
        { error: 'Csak aktív (open) epizódhoz lehet új milestone-t rögzíteni' },
        { status: 400 }
      );
    }

    const insertResult = await pool.query(
      `INSERT INTO patient_milestones (patient_id, episode_id, code, at, params, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, patient_id as "patientId", episode_id as "episodeId", code, at, params, note, created_by as "createdBy", created_at as "createdAt"`,
      [patientId, episodeId, code, at, milestoneParams ? JSON.stringify(milestoneParams) : null, note, auth.email]
    );

    const milestone = rowToMilestone(insertResult.rows[0]);
    return NextResponse.json({ milestone }, { status: 201 });
  } catch (error) {
    console.error('Error creating milestone:', error);
    return NextResponse.json(
      { error: 'Hiba történt a milestone rögzítésekor' },
      { status: 500 }
    );
  }
}
