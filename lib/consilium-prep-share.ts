import { createHash, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { normalizeChecklist, type SessionStatus } from '@/lib/consilium';
import type { ConsiliumPrepCommentSnapshot } from '@/lib/consilium-view-helpers';

export const PREP_LINK_DEFAULT_EXPIRY_DAYS = 14;
export const PREP_COMMENT_MAX_LENGTH = 4000;
/** Gyakorlatban "nem lejáró" token dátum (amíg vissza nem vonják). */
export const PREP_LINK_NO_EXPIRY_AT_ISO = '9999-12-31T23:59:59.999Z';

export function hashConsiliumPrepToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function generateConsiliumPrepTokenRaw(): string {
  return randomBytes(32).toString('base64url');
}

export type PrepTokenResolution = {
  sessionId: string;
  itemId: string;
  institutionId: string;
  sessionStatus: SessionStatus;
};

export async function resolvePrepTokenForUser(
  rawToken: string,
  userInstitutionId: string,
): Promise<PrepTokenResolution | null> {
  const pool = getDbPool();
  const hash = hashConsiliumPrepToken(rawToken.trim());
  const r = await pool.query<{
    sessionId: string;
    itemId: string;
    institutionId: string;
    status: string;
  }>(
    `SELECT t.session_id as "sessionId", t.item_id as "itemId", s.institution_id as "institutionId", s.status
     FROM consilium_item_prep_tokens t
     JOIN consilium_sessions s ON s.id = t.session_id
     JOIN consilium_session_items i ON i.id = t.item_id AND i.session_id = t.session_id
     WHERE t.token_hash = $1
       AND t.revoked_at IS NULL
       AND btrim(coalesce(s.institution_id, '')) = btrim(coalesce($2::text, ''))`,
    [hash, userInstitutionId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const st = row.status as SessionStatus;
  if (st !== 'draft' && st !== 'active' && st !== 'closed') {
    return null;
  }
  return {
    sessionId: row.sessionId,
    itemId: row.itemId,
    institutionId: row.institutionId,
    sessionStatus: st,
  };
}

export async function assertPrepTokenOrThrow(
  rawToken: string,
  userInstitutionId: string,
): Promise<PrepTokenResolution> {
  const x = await resolvePrepTokenForUser(rawToken, userInstitutionId);
  if (!x) {
    throw new HttpError(404, 'Érvénytelen vagy lejárt előkészítő link', 'PREP_TOKEN_INVALID');
  }
  return x;
}

export const createPrepLinkBodySchema = z.object({
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const prepCommentBodySchema = z.object({
  checklistKey: z.string().min(1).max(256),
  body: z.string().min(1).max(PREP_COMMENT_MAX_LENGTH),
});

export async function revokePrepTokensForItem(client: PoolClient, itemId: string): Promise<void> {
  await client.query(
    `UPDATE consilium_item_prep_tokens SET revoked_at = NOW() WHERE item_id = $1::uuid AND revoked_at IS NULL`,
    [itemId],
  );
}

export async function listPrepCommentsForItem(itemId: string): Promise<ConsiliumPrepCommentSnapshot[]> {
  const pool = getDbPool();
  const r = await pool.query<{
    id: string;
    checklistKey: string;
    body: string;
    authorDisplay: string;
    createdAt: Date;
  }>(
    `SELECT id, checklist_key as "checklistKey", body, author_display as "authorDisplay", created_at as "createdAt"
     FROM consilium_prep_comments
     WHERE item_id = $1::uuid
     ORDER BY created_at ASC`,
    [itemId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    checklistKey: row.checklistKey,
    body: row.body,
    authorDisplay: row.authorDisplay,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }));
}

export async function authorDisplayForUser(userId: string): Promise<string> {
  const pool = getDbPool();
  const r = await pool.query<{ d: string }>(
    `SELECT COALESCE(NULLIF(btrim(doktor_neve), ''), email) as d FROM users WHERE id = $1::uuid AND active = true`,
    [userId],
  );
  if (r.rows.length === 0) {
    throw new HttpError(403, 'Felhasználó nem található', 'USER_NOT_FOUND');
  }
  return r.rows[0].d;
}

/** Ellenőrzi, hogy a checklist kulcs létezik a tételen. */
export async function assertChecklistKeyOnItem(itemId: string, sessionId: string, checklistKey: string): Promise<void> {
  const pool = getDbPool();
  const r = await pool.query<{ checklist: unknown }>(
    `SELECT checklist FROM consilium_session_items WHERE id = $1::uuid AND session_id = $2::uuid`,
    [itemId, sessionId],
  );
  if (r.rows.length === 0) {
    throw new HttpError(404, 'Elem nem található', 'ITEM_NOT_FOUND');
  }
  const keys = new Set(normalizeChecklist(r.rows[0].checklist).map((e) => e.key));
  if (!keys.has(checklistKey)) {
    throw new HttpError(400, 'Ismeretlen napirendi pont', 'CHECKLIST_KEY_UNKNOWN');
  }
}
