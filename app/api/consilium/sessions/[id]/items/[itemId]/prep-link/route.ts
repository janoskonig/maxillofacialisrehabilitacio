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

  const expiresAtIso = new Date(PREP_LINK_NO_EXPIRY_AT_ISO).toISOString();
  const client = await pool.connect();
  let rawToken: string;
  let expiresAtResponse: string;
  let created = false;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM consilium_session_items WHERE id = $1::uuid FOR UPDATE`, [itemId]);
    const existing = await client.query<{ rawToken: string; expiresAt: Date }>(
      `SELECT raw_token AS "rawToken", expires_at AS "expiresAt"
       FROM consilium_item_prep_tokens
       WHERE item_id = $1::uuid AND revoked_at IS NULL AND raw_token IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [itemId],
    );
    if (existing.rows.length > 0) {
      rawToken = existing.rows[0].rawToken;
      expiresAtResponse =
        existing.rows[0].expiresAt instanceof Date
          ? existing.rows[0].expiresAt.toISOString()
          : String(existing.rows[0].expiresAt);
      await client.query('COMMIT');
    } else {
      rawToken = generateConsiliumPrepTokenRaw();
      const tokenHash = hashConsiliumPrepToken(rawToken);
      await revokePrepTokensForItem(client, itemId);
      await client.query(
        `INSERT INTO consilium_item_prep_tokens (token_hash, raw_token, session_id, item_id, created_by, expires_at)
         VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6)`,
        [tokenHash, rawToken, sessionId, itemId, auth.email, expiresAtIso],
      );
      await client.query('COMMIT');
      expiresAtResponse = expiresAtIso;
      created = true;
    }
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
      expiresAt: expiresAtResponse,
      prepPath,
      prepUrl,
    },
    { status: created ? 201 : 200 },
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
