import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import {
  addSessionItemSchema,
  assertSessionWritableForItems,
  ensurePatientVisibleForUser,
  getScopedSessionOrThrow,
  getUserInstitution,
  insertConsiliumSessionItemInTx,
  normalizeChecklist,
} from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItems(session.status);

  const body = addSessionItemSchema.parse(await req.json());
  await ensurePatientVisibleForUser(body.patientId, auth, institutionId);

  const checklist = normalizeChecklist(body.checklist ?? []);

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await insertConsiliumSessionItemInTx(client, {
      sessionId,
      patientId: body.patientId,
      email: auth.email,
      discussed: body.discussed ?? null,
      checklist,
    });
    await client.query('COMMIT');
    return NextResponse.json({ item: row }, { status: 201 });
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
