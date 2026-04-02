import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  assertSessionWritableForItems,
  ensurePatientVisibleForUser,
  findNextUpcomingDraftSession,
  getUserInstitution,
  insertConsiliumSessionItemInTx,
} from '@/lib/consilium';

export const dynamic = 'force-dynamic';

const enrollBodySchema = z.object({
  patientId: z.string().uuid(),
});

export const POST = authedHandler(async (req, { auth }) => {
  const institutionId = await getUserInstitution(auth);
  const nextSession = await findNextUpcomingDraftSession(institutionId);
  if (!nextSession) {
    return NextResponse.json(
      {
        error: 'Nincs soron következő, még szerkeszthető (vázlat) konzílium alkalom jövőbeli időponttal.',
        code: 'NO_UPCOMING_DRAFT',
      },
      { status: 404 },
    );
  }

  const body = enrollBodySchema.parse(await req.json());
  await ensurePatientVisibleForUser(body.patientId, auth, institutionId);

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `SELECT status FROM consilium_sessions
       WHERE id = $1::uuid
         AND btrim(coalesce(institution_id, '')) = btrim(coalesce($2::text, ''))
       FOR UPDATE`,
      [nextSession.id, institutionId],
    );
    if (lock.rows.length === 0) {
      throw new HttpError(404, 'Konzílium alkalom nem található', 'SESSION_NOT_FOUND');
    }
    assertSessionWritableForItems(lock.rows[0].status);

    const item = await insertConsiliumSessionItemInTx(client, {
      sessionId: nextSession.id,
      patientId: body.patientId,
      email: auth.email,
      checklist: [],
    });
    await client.query('COMMIT');
    return NextResponse.json({ sessionId: nextSession.id, session: nextSession, item }, { status: 201 });
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') {
      return NextResponse.json({ error: 'Ez a beteg már szerepel az alkalmon' }, { status: 409 });
    }
    throw e;
  } finally {
    client.release();
  }
});
