import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { logActivity } from '@/lib/activity';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import {
  detectSchedulingIntegrityViolations,
  repairSchedulingIntegrity,
} from '@/lib/scheduling-integrity';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/scheduling-integrity
 * Returns scheduling violations for this episode (diagnostic).
 *
 * WP-1.2: a detektálás/javítás logika a `lib/scheduling-integrity.ts`-be
 * költözött, mert a javítható violationöket a rendszer mostantól automatikusan
 * rendezi (a terv-kártya olvasásakor és az admin-scannél), a maradék pedig az
 * /admin „Ütemezési integritás" fülön jelenik meg — nem a betegkartonon.
 */
export const GET = authedHandler(async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const episodeResult = await pool.query(
    `SELECT pe.id, pe.status, pe.patient_id as "patientId"
     FROM patient_episodes pe
     WHERE pe.id = $1`,
    [episodeId]
  );

  if (episodeResult.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  const episode = episodeResult.rows[0];
  const violations = await detectSchedulingIntegrityViolations(
    pool,
    episodeId,
    episode.status
  );

  return NextResponse.json({
    episodeId,
    status: episode.status,
    violations,
    ok: violations.length === 0,
  });
});

/**
 * POST /api/episodes/:id/scheduling-integrity
 *
 * Biztonságos, szűk hatókörű javítás (lib/scheduling-integrity.ts):
 *  - `EWP_DANGLING_APPOINTMENT_LINK` → `ewp.appointment_id = NULL`,
 *    `scheduled → pending` (ha az volt), audit-bejegyzéssel.
 *  - `APPOINTMENT_STEP_MISMATCH` → `appointments.step_code` és `step_seq`
 *    átírása az ewp szerint (az ewp az SSOT, mert a worklist is így matchel).
 *
 * A művelet IDEMPOTENT és auditált. NEM módosít slot-ot, nem törli a
 * foglalást, nem nyúl a kezelési úthoz. A WP-1.2 óta ugyanez fut
 * automatikusan is; ez az endpoint kézi/explicit triggerként marad meg.
 *
 * Csak admin / beutalo_orvos / fogpótlástanász hívhatja.
 */
export const POST = roleHandler(
  ['admin', 'beutalo_orvos', 'fogpótlástanász'],
  async (req, { auth, params }) => {
    const episodeId = params.id;
    const pool = getDbPool();

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const reasonInput = typeof body?.reason === 'string' ? body.reason.trim() : '';

    const episodeResult = await pool.query(
      `SELECT pe.id, pe.status FROM patient_episodes pe WHERE pe.id = $1`,
      [episodeId]
    );
    if (episodeResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Epizód nem található' },
        { status: 404 }
      );
    }

    const changedBy = auth.email ?? auth.userId ?? 'unknown';
    const reasonSuffix = reasonInput.length > 0 ? ` — ${reasonInput}` : '';

    let result;
    try {
      result = await repairSchedulingIntegrity(pool, episodeId, {
        changedBy,
        reasonSuffix,
      });
    } catch (err) {
      logger.error('[scheduling-integrity/repair] transaction failed', {
        episodeId,
        err,
      });
      return NextResponse.json(
        { error: 'Integritás-javítás nem sikerült — adatbázis hiba' },
        { status: 500 }
      );
    }

    if (result.danglingCleared === 0 && result.mismatchRepaired === 0) {
      return NextResponse.json({
        ok: true,
        danglingCleared: 0,
        mismatchRepaired: 0,
        message: 'Nincs mit javítani',
      });
    }

    try {
      await logActivity(
        req,
        auth.email,
        'episode_integrity_repaired',
        `Episode ${episodeId}: ${result.danglingCleared} dangling link takarítva, ${result.mismatchRepaired} step mismatch javítva${reasonSuffix}`
      );
    } catch {
      /* non-blocking */
    }

    try {
      await emitSchedulingEvent(
        'episode',
        episodeId,
        'integrity_repaired'
      );
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({
      ok: true,
      danglingCleared: result.danglingCleared,
      mismatchRepaired: result.mismatchRepaired,
    });
  }
);
