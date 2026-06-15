import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { requireCronKey } from '@/lib/api/cron-auth';
import { sendPushNotificationToMultiple } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * Legkisebb időköz (óra) két összesítő push között. A cron-sync.js percenként hív
 * a megcélzott órákban (09/13/17 Budapest), így a `last_sent_at` cooldown akadályozza
 * meg, hogy az órán belüli ~60 ismétlés mind push-t küldjön. 2h < a legszűkebb
 * ablakköz (4h), így mindhárom napi ablak pontosan egyszer szól.
 */
const MIN_INTERVAL_HOURS = 2;

/** Magyar címkék a feedback.type értékekhez (lásd components/FeedbackButton.tsx). */
const TYPE_LABELS: Record<string, string> = {
  bug: 'Hiba',
  error: 'Hiba (error)',
  crash: 'Összeomlás',
  suggestion: 'Javaslat',
  other: 'Egyéb',
};

type SummaryRow = {
  open_count: number;
  new_24h: number;
  bug_count: number;
  error_count: number;
};

type LatestRow = {
  title: string | null;
  type: string;
};

/**
 * GET /api/feedback/summary/cron
 *
 * Külső / belső ütemező (cron-sync.js, naponta háromszor: 09/13/17 Budapest) hívja
 * `x-api-key`-jel (GOOGLE_CALENDAR_SYNC_API_KEY). Ha van nyitott (`status='open'`)
 * visszajelzés, push-emlékeztetőt küld minden aktív adminnak a nyitott bejelentések
 * számával és a legutóbbi tételével. A `feedback_summary_state.last_sent_at` cooldown
 * (alap 2h) garantálja, hogy a percenkénti cron-futások közül ablakonként csak egy
 * küldjön. `?force=1` megkerüli a cooldownt (teszteléshez).
 */
export const GET = apiHandler(async (req, { correlationId }) => {
  const startTime = Date.now();
  requireCronKey(req, 'GOOGLE_CALENDAR_SYNC_API_KEY');

  const force = req.nextUrl.searchParams.get('force') === '1';
  const pool = getDbPool();

  // Részletes JSON mód (?detail=1): a triage-routine ezt hívja a cron-kulccsal,
  // hogy a nyitott bejelentések tartalmát is megkapja. Tisztán olvasás — nem küld
  // push-t és nem írja a cooldownt (azt a push-mód kezeli).
  if (req.nextUrl.searchParams.get('detail') === '1') {
    const { rows: items } = await pool.query(`
      SELECT id, type, title, description,
             LEFT(COALESCE(error_log, ''), 4000)   AS error_log,
             LEFT(COALESCE(error_stack, ''), 4000) AS error_stack,
             url, user_email, status, created_at
      FROM feedback
      WHERE status = 'open'
      ORDER BY created_at DESC
      LIMIT 200
    `);
    logger.info(`[feedback-summary][${correlationId}] detail mód: ${items.length} nyitott tétel.`);
    return NextResponse.json({
      success: true,
      mode: 'detail',
      openCount: items.length,
      items,
      generatedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
    });
  }

  // Cooldown-állapot tábla (lusta létrehozás — nincs külön migráció, lásd
  // admin_notification_batch_state mintát a daily-summary-ben).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback_summary_state (
      id INT PRIMARY KEY DEFAULT 1,
      last_sent_at TIMESTAMPTZ
    )
  `);

  // Nyitott visszajelzések összesítése.
  const { rows: summaryRows } = await pool.query<SummaryRow>(`
    SELECT
      COUNT(*)::int                                                              AS open_count,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int      AS new_24h,
      COUNT(*) FILTER (WHERE type = 'bug')::int                                   AS bug_count,
      COUNT(*) FILTER (WHERE type IN ('error', 'crash'))::int                     AS error_count
    FROM feedback
    WHERE status = 'open'
  `);
  const summary = summaryRows[0] ?? { open_count: 0, new_24h: 0, bug_count: 0, error_count: 0 };

  if (summary.open_count === 0) {
    logger.info(`[feedback-summary][${correlationId}] Nincs nyitott visszajelzés, kihagyva.`);
    return NextResponse.json({
      success: true,
      sent: false,
      reason: 'no_open_feedback',
      openCount: 0,
      duration: Date.now() - startTime,
    });
  }

  // Cooldown ellenőrzés (force kihagyja).
  if (!force) {
    const { rows: stateRows } = await pool.query<{ last_sent_at: Date | null }>(
      'SELECT last_sent_at FROM feedback_summary_state WHERE id = 1'
    );
    const lastSent = stateRows[0]?.last_sent_at;
    if (lastSent) {
      const hoursSince = (Date.now() - new Date(lastSent).getTime()) / 3_600_000;
      if (hoursSince < MIN_INTERVAL_HOURS) {
        logger.info(
          `[feedback-summary][${correlationId}] Cooldown (utolsó küldés ${hoursSince.toFixed(1)}h, min ${MIN_INTERVAL_HOURS}h), kihagyva.`
        );
        return NextResponse.json({
          success: true,
          sent: false,
          reason: 'cooldown',
          openCount: summary.open_count,
          duration: Date.now() - startTime,
        });
      }
    }
  }

  // Legutóbbi nyitott tétel a push törzséhez.
  const { rows: latestRows } = await pool.query<LatestRow>(`
    SELECT title, type
    FROM feedback
    WHERE status = 'open'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const latest = latestRows[0];
  const latestLabel = latest
    ? (latest.title?.trim() || TYPE_LABELS[latest.type] || latest.type)
    : null;

  // Aktív adminok.
  const { rows: adminRows } = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'admin' AND active = true"
  );
  const adminIds = adminRows.map((r) => r.id);

  // Push törzs összeállítása.
  const parts: string[] = [];
  if (summary.bug_count > 0) parts.push(`${summary.bug_count} hiba`);
  if (summary.error_count > 0) parts.push(`${summary.error_count} error/crash`);
  const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const newSuffix = summary.new_24h > 0 ? ` — ${summary.new_24h} új az elmúlt napban` : '';
  const latestSuffix = latestLabel ? ` Legutóbbi: „${latestLabel}".` : '';

  const body =
    `${summary.open_count} nyitott visszajelzés${breakdown}${newSuffix}.${latestSuffix}`;

  await sendPushNotificationToMultiple(adminIds, {
    title: 'Nyitott visszajelzések',
    body,
    tag: 'feedback-summary',
    data: {
      type: 'reminder',
      url: '/admin',
    },
  });

  // Cooldown frissítése.
  await pool.query(`
    INSERT INTO feedback_summary_state (id, last_sent_at)
    VALUES (1, NOW())
    ON CONFLICT (id) DO UPDATE SET last_sent_at = NOW()
  `);

  const duration = Date.now() - startTime;
  logger.info(
    `[feedback-summary][${correlationId}] Push kiküldve ${adminIds.length} adminnak: ${summary.open_count} nyitott (${summary.new_24h} új) ${duration}ms.`
  );

  return NextResponse.json({
    success: true,
    sent: true,
    openCount: summary.open_count,
    new24h: summary.new_24h,
    bugCount: summary.bug_count,
    errorCount: summary.error_count,
    recipients: adminIds.length,
    duration,
  });
});
