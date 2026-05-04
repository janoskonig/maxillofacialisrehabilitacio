import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  createPrepLinkBodySchema,
  ensurePrepTokenForItem,
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

  const client = await pool.connect();
  let rawToken: string;
  let expiresAtResponse: string;
  let created = false;
  try {
    await client.query('BEGIN');
    const ensured = await ensurePrepTokenForItem(client, {
      sessionId,
      itemId,
      createdBy: auth.email,
    });
    rawToken = ensured.rawToken;
    expiresAtResponse = ensured.expiresAtIso;
    created = ensured.created;
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
