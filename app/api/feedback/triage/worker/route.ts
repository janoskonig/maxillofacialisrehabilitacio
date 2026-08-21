import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { requireCronKey } from '@/lib/api/cron-auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const CLAIM_MINUTES = 120;
const MAX_RESULT_LENGTH = 12_000;
const RESULT_FIELDS = [
  'summary',
  'rootCause',
  'verification',
  'commit',
  'branch',
  'pullRequest',
  'blocker',
] as const;

type ResultField = (typeof RESULT_FIELDS)[number];
type WorkerResult = Partial<Record<ResultField, string>> & {
  needsHumanReview?: boolean;
};

function hashClaimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseWorkerResult(value: unknown): WorkerResult {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('A result objektum kell legyen');
  }

  const input = value as Record<string, unknown>;
  const result: WorkerResult = {};
  for (const field of RESULT_FIELDS) {
    const fieldValue = input[field];
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== 'string') throw new TypeError(`A result.${field} szöveg kell legyen`);
    const trimmed = fieldValue.trim();
    if (trimmed.length > MAX_RESULT_LENGTH) {
      throw new RangeError(`A result.${field} legfeljebb ${MAX_RESULT_LENGTH} karakter lehet`);
    }
    if (trimmed) result[field] = trimmed;
  }
  if (input.needsHumanReview !== undefined) {
    if (typeof input.needsHumanReview !== 'boolean') {
      throw new TypeError('A result.needsHumanReview logikai érték kell legyen');
    }
    result.needsHumanReview = input.needsHumanReview;
  }
  return result;
}

function resultNote(result: WorkerResult, action: 'complete' | 'release'): string {
  const lines = [
    `[Codex triázs · ${new Date().toISOString()} · ${action === 'complete' ? 'ellenőrzésre kész' : 'visszaengedve'}]`,
  ];
  if (result.summary) lines.push(`Összefoglaló: ${result.summary}`);
  if (result.rootCause) lines.push(`Ok: ${result.rootCause}`);
  if (result.verification) lines.push(`Ellenőrzés: ${result.verification}`);
  if (result.commit) lines.push(`Commit: ${result.commit}`);
  if (result.branch) lines.push(`Branch: ${result.branch}`);
  if (result.pullRequest) lines.push(`PR: ${result.pullRequest}`);
  if (result.blocker) lines.push(`Blokkoló tényező: ${result.blocker}`);
  if (result.needsHumanReview !== undefined) {
    lines.push(`Emberi ellenőrzés: ${result.needsHumanReview ? 'szükséges' : 'javasolt'}`);
  }
  return lines.join('\n');
}

/**
 * POST /api/feedback/triage/worker
 *
 * Atomikusan lefoglal legfeljebb egy aktív ticketet. Csak `open`, illetve
 * lejárt worker-foglalású `in_progress` ticket választható. A végpont nem zár
 * ticketet, nem küld emailt, és nem adja vissza a bejelentő email-címét.
 */
export const POST = apiHandler(async (req, { correlationId }) => {
  requireCronKey(req, 'FEEDBACK_TRIAGE_API_KEY');

  const pool = getDbPool();
  const client = await pool.connect();
  const claimToken = randomBytes(32).toString('hex');
  const claimHash = hashClaimToken(claimToken);
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const { rows } = await client.query(
      `WITH candidate AS (
         SELECT id
         FROM feedback
         WHERE status = 'open'
            OR (
              status = 'in_progress'
              AND triage_worker_claim_expires_at IS NOT NULL
              AND triage_worker_claim_expires_at <= CURRENT_TIMESTAMP
            )
         ORDER BY priority_score DESC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE feedback AS f
       SET status = 'in_progress',
           triage_worker_claim_hash = $1,
           triage_worker_claimed_at = CURRENT_TIMESTAMP,
           triage_worker_claim_expires_at = CURRENT_TIMESTAMP + ($2 * INTERVAL '1 minute'),
           triage_worker_attempts = triage_worker_attempts + 1,
           updated_at = CURRENT_TIMESTAMP
       FROM candidate
       WHERE f.id = candidate.id
       RETURNING f.id, f.type, f.title, f.description,
                 LEFT(COALESCE(f.error_log, ''), 12000) AS error_log,
                 LEFT(COALESCE(f.error_stack, ''), 12000) AS error_stack,
                 f.user_agent, f.url, f.status, f.priority, f.priority_score,
                 f.priority_reasons, f.triaged_at, f.created_at, f.updated_at,
                 f.triage_worker_claimed_at, f.triage_worker_claim_expires_at,
                 f.triage_worker_attempts`,
      [claimHash, CLAIM_MINUTES],
    );

    await client.query('COMMIT');
    transactionOpen = false;

    if (rows.length === 0) {
      return NextResponse.json({ success: true, claimed: false, reason: 'empty_queue' });
    }

    logger.info(
      `[feedback-triage-worker][${correlationId}] Ticket lefoglalva: ` +
        `ticket=${rows[0].id} priority=${rows[0].priority} attempt=${rows[0].triage_worker_attempts}`,
    );
    return NextResponse.json({
      success: true,
      claimed: true,
      claimToken,
      claimMinutes: CLAIM_MINUTES,
      ticket: rows[0],
    });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/feedback/triage/worker
 *
 * A lefoglalt ticket triázseredményét menti. `complete` esetén a ticket
 * `in_progress` marad emberi ellenőrzésre; `release` esetén visszakerül `open`
 * állapotba. Bejelentői válasz és automatikus lezárás itt szándékosan nincs.
 */
export const PATCH = apiHandler(async (req, { correlationId }) => {
  requireCronKey(req, 'FEEDBACK_TRIAGE_API_KEY');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Érvénytelen JSON' }, { status: 400 });
  }

  const ticketId = typeof body.ticketId === 'string' ? body.ticketId.trim() : '';
  const claimToken = typeof body.claimToken === 'string' ? body.claimToken.trim() : '';
  const action = body.action;
  if (!ticketId || !claimToken || (action !== 'complete' && action !== 'release')) {
    return NextResponse.json(
      { error: 'ticketId, claimToken és action (complete vagy release) kötelező' },
      { status: 400 },
    );
  }

  let result: WorkerResult;
  try {
    result = parseWorkerResult(body.result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Érvénytelen result' },
      { status: 400 },
    );
  }

  const aiDraftResponse = body.aiDraftResponse;
  if (aiDraftResponse !== undefined && typeof aiDraftResponse !== 'string') {
    return NextResponse.json({ error: 'Az aiDraftResponse szöveg kell legyen' }, { status: 400 });
  }
  const trimmedDraft = typeof aiDraftResponse === 'string' ? aiDraftResponse.trim() : undefined;
  if (trimmedDraft && trimmedDraft.length > MAX_RESULT_LENGTH) {
    return NextResponse.json(
      { error: `Az aiDraftResponse legfeljebb ${MAX_RESULT_LENGTH} karakter lehet` },
      { status: 400 },
    );
  }

  const completedAt = new Date().toISOString();
  const structuredResult = { ...result, action, completedAt };
  const note = resultNote(result, action);
  const claimHash = hashClaimToken(claimToken);
  const pool = getDbPool();
  const { rows } = await pool.query(
    `UPDATE feedback
     SET status = $1,
         triage_worker_claim_hash = NULL,
         triage_worker_claim_expires_at = NULL,
         triage_worker_last_result = $2::jsonb,
         admin_note = CASE
           WHEN NULLIF(BTRIM(COALESCE(admin_note, '')), '') IS NULL THEN $3
           ELSE admin_note || E'\n\n' || $3
         END,
         ai_draft_response = CASE
           WHEN $4::text IS NULL THEN ai_draft_response
           ELSE NULLIF($4, '')
         END,
         ai_draft_at = CASE
           WHEN $4::text IS NULL THEN ai_draft_at
           WHEN NULLIF($4, '') IS NULL THEN NULL
           ELSE CURRENT_TIMESTAMP
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5
       AND triage_worker_claim_hash = $6
     RETURNING id, status, priority, admin_note, ai_draft_response,
               triage_worker_last_result, updated_at`,
    [
      action === 'release' ? 'open' : 'in_progress',
      JSON.stringify(structuredResult),
      note,
      trimmedDraft ?? null,
      ticketId,
      claimHash,
    ],
  );

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'A ticket vagy az aktív foglalás nem található' },
      { status: 409 },
    );
  }

  logger.info(
    `[feedback-triage-worker][${correlationId}] Triázseredmény mentve: ` +
      `ticket=${ticketId} action=${action}`,
  );
  return NextResponse.json({ success: true, feedback: rows[0], emailSent: false, closed: false });
});
