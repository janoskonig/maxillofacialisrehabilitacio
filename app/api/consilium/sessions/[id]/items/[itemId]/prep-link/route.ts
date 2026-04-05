import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  createPrepLinkBodySchema,
  generateConsiliumPrepTokenRaw,
  hashConsiliumPrepToken,
  PREP_LINK_DEFAULT_EXPIRY_DAYS,
  revokePrepTokensForItem,
} from '@/lib/consilium-prep-share';
import { getScopedSessionOrThrow, getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const institutionId = await getUserInstitution(auth);
  await getScopedSessionOrThrow(sessionId, institutionId);

  const body = createPrepLinkBodySchema.safeParse(await req.json().catch(() => ({})));
  const expiresInDays = body.success ? (body.data.expiresInDays ?? PREP_LINK_DEFAULT_EXPIRY_DAYS) : PREP_LINK_DEFAULT_EXPIRY_DAYS;

  const pool = getDbPool();
  const check = await pool.query(
    `SELECT id FROM consilium_session_items WHERE id = $1::uuid AND session_id = $2::uuid`,
    [itemId, sessionId],
  );
  if (check.rows.length === 0) {
    throw new HttpError(404, 'Elem nem található ebben az alkalomban', 'ITEM_NOT_FOUND');
  }

  const rawToken = generateConsiliumPrepTokenRaw();
  const tokenHash = hashConsiliumPrepToken(rawToken);
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + expiresInDays);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await revokePrepTokensForItem(client, itemId);
    await client.query(
      `INSERT INTO consilium_item_prep_tokens (token_hash, session_id, item_id, created_by, expires_at)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5)`,
      [tokenHash, sessionId, itemId, auth.email, expiresAt.toISOString()],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const prepPath = `/consilium/prep/${encodeURIComponent(rawToken)}`;
  return NextResponse.json(
    {
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
      prepPath,
    },
    { status: 201 },
  );
});

export const DELETE = authedHandler(async (_req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const institutionId = await getUserInstitution(auth);
  await getScopedSessionOrThrow(sessionId, institutionId);

  const pool = getDbPool();
  const check = await pool.query(
    `SELECT id FROM consilium_session_items WHERE id = $1::uuid AND session_id = $2::uuid`,
    [itemId, sessionId],
  );
  if (check.rows.length === 0) {
    throw new HttpError(404, 'Elem nem található ebben az alkalomban', 'ITEM_NOT_FOUND');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await revokePrepTokensForItem(client, itemId);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return new NextResponse(null, { status: 204 });
});
