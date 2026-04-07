import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  createPrepLinkBodySchema,
  generateConsiliumPrepTokenRaw,
  hashConsiliumPrepToken,
  PREP_LINK_NO_EXPIRY_AT_ISO,
  revokePrepTokensForItem,
} from '@/lib/consilium-prep-share';
import { getScopedSessionOrThrow, getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

function resolvePublicBaseUrl(req: Request): string {
  const envBase = (process.env.NEXT_PUBLIC_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/+$/, '');
  const h = req.headers;
  const xfHost = (h.get('x-forwarded-host') || '').trim();
  const host = xfHost || (h.get('host') || '').trim();
  const xfProto = (h.get('x-forwarded-proto') || '').trim();
  const proto = xfProto || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
  if (host) return `${proto}://${host}`;
  return 'https://rehabilitacios-protetika.hu';
}

export const POST = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const institutionId = await getUserInstitution(auth);
  await getScopedSessionOrThrow(sessionId, institutionId);

  // Backward compatible: elfogadjuk a body-t, de az előkészítő link már nem jár le automatikusan.
  createPrepLinkBodySchema.safeParse(await req.json().catch(() => ({})));

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
  const expiresAt = new Date(PREP_LINK_NO_EXPIRY_AT_ISO);

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
  const prepUrl = `${resolvePublicBaseUrl(req)}${prepPath}`;
  return NextResponse.json(
    {
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
      prepPath,
      prepUrl,
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
