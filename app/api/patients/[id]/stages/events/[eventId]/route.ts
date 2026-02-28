import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import type { StageEventEntry } from '@/lib/types';

/**
 * Adminként stádium esemény kezdeti időpontjának módosítása.
 * PATCH /api/patients/[id]/stages/events/[eventId]
 * Body: { at: "ISO date string" }
 */
export const dynamic = 'force-dynamic';

export const PATCH = roleHandler(['admin'], async (req, { auth, params }) => {
  const patientId = params.id;
  const eventId = params.eventId;

  const body = await req.json().catch(() => ({}));
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
});
