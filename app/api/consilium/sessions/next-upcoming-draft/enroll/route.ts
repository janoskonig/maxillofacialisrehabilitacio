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
    const sourceRows = await client.query<{ itemId: string; sessionId: string }>(
      `SELECT i.id as "itemId", i.session_id as "sessionId"
       FROM consilium_session_items i
       JOIN consilium_sessions s ON s.id = i.session_id
       WHERE i.patient_id = $1::uuid
         AND i.session_id <> $2::uuid
         AND s.status = 'draft'
         AND btrim(coalesce(s.institution_id, '')) = btrim(coalesce($3::text, ''))
       ORDER BY s.scheduled_at ASC
       FOR UPDATE OF i`,
      [body.patientId, nextSession.id, institutionId],
    );

    let item: {
      id: string;
      sessionId: string;
      patientId: string;
      sortOrder: number;
      discussed: boolean;
      checklist: unknown;
    };
    if (sourceRows.rows.length > 1) {
      throw new HttpError(
        409,
        'A beteg több draft konzílium alkalmon is szerepel; egyszerre csak egyből lehet automatikusan áttenni.',
        'PATIENT_ON_MULTIPLE_DRAFTS',
      );
    } else if (sourceRows.rows.length === 1) {
      const source = sourceRows.rows[0];
      const maxRow = await client.query<{ maxSort: string }>(
        `SELECT COALESCE(MAX(sort_order), 0) as "maxSort" FROM consilium_session_items WHERE session_id = $1::uuid`,
        [nextSession.id],
      );
      const nextSort = Number(maxRow.rows[0]?.maxSort ?? 0) + 1;

      const moved = await client.query(
        `UPDATE consilium_session_items
         SET session_id = $2::uuid,
             sort_order = $3,
             updated_by = $4,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING
           id,
           session_id as "sessionId",
           patient_id as "patientId",
           sort_order as "sortOrder",
           discussed,
           checklist`,
        [source.itemId, nextSession.id, nextSort, auth.email],
      );
      if (moved.rows.length === 0) {
        throw new HttpError(404, 'Áthelyezendő elem nem található', 'ITEM_NOT_FOUND');
      }

      await client.query(
        `UPDATE consilium_prep_comments
         SET session_id = $2::uuid
         WHERE item_id = $1::uuid`,
        [source.itemId, nextSession.id],
      );
      await client.query(
        `UPDATE consilium_item_prep_tokens
         SET session_id = $2::uuid
         WHERE item_id = $1::uuid`,
        [source.itemId, nextSession.id],
      );
      item = moved.rows[0];
    } else {
      item = await insertConsiliumSessionItemInTx(client, {
        sessionId: nextSession.id,
        patientId: body.patientId,
        email: auth.email,
        checklist: [],
      });
    }
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
