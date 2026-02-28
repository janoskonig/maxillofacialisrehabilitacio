import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import type { StageEventEntry } from '@/lib/types';
import { logger } from '@/lib/logger';

/**
 * Adminként stádium esemény kezdeti időpontjának módosítása.
 * PATCH /api/patients/[id]/stages/events/[eventId]
 * Body: { at: "ISO date string" }
 */
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; eventId: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    if (auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak admin módosíthatja a stádium kezdetét' },
        { status: 403 }
      );
    }

    const patientId = params.id;
    const eventId = params.eventId;

    const body = await request.json().catch(() => ({}));
    const atRaw = body.at;
    if (atRaw == null || typeof atRaw !== 'string') {
      return NextResponse.json(
        { error: 'at kötelező (ISO dátum string)' },
        { status: 400 }
      );
    }

    const at = new Date(atRaw);
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json(
        { error: 'Érvénytelen dátum' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    const eventCheck = await pool.query(
      `SELECT id, patient_id FROM stage_events WHERE id = $1 AND patient_id = $2`,
      [eventId, patientId]
    );
    if (eventCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Esemény nem található vagy nem ehhez a beteghez tartozik' },
        { status: 404 }
      );
    }

    const updateResult = await pool.query(
      `UPDATE stage_events SET at = $1 WHERE id = $2 AND patient_id = $3
       RETURNING id, patient_id as "patientId", episode_id as "episodeId", stage_code as "stageCode", at, note, created_by as "createdBy", created_at as "createdAt"`,
      [at, eventId, patientId]
    );

    const row = updateResult.rows[0];
    const updated: StageEventEntry = {
      id: row.id,
      patientId: row.patientId,
      episodeId: row.episodeId,
      stageCode: row.stageCode,
      at: (row.at as Date)?.toISOString?.() ?? at.toISOString(),
      note: row.note ?? null,
      createdBy: row.createdBy ?? null,
      createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
    };

    return NextResponse.json({ stage: updated });
  } catch (error) {
    logger.error('Error updating stage event:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stádium kezdet módosításakor' },
      { status: 500 }
    );
  }
}
