import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { requireCronKey } from '@/lib/api/cron-auth';
import { sendPushNotificationToMultiple } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

type CriticalSummaryRow = {
  critical_count: number;
  new_24h: number;
  oldest_created_at: Date | null;
};

/**
 * GET /api/feedback/summary/cron
 *
 * A cron óránként többször is meghívhatja, de a Budapest szerinti naptári napra
 * atomikusan csak egy kritikus digest mehet ki. Csak a lezáratlan (`open` vagy
 * `in_progress`) és `critical` prioritású ticketek kerülnek bele.
 *
 * `?detail=1`: tisztán olvasó mód az automatizált triage számára.
 * `?force=1`: az aznapi korlát megkerülése kizárólag cron-kulccsal végzett teszthez.
 */
export const GET = apiHandler(async (req, { correlationId }) => {
  const startTime = Date.now();
  requireCronKey(req, 'GOOGLE_CALENDAR_SYNC_API_KEY');

  const force = req.nextUrl.searchParams.get('force') === '1';
  const pool = getDbPool();

  if (req.nextUrl.searchParams.get('detail') === '1') {
    const { rows: items } = await pool.query(`
      SELECT id, type, title, description,
             LEFT(COALESCE(error_log, ''), 4000)   AS error_log,
             LEFT(COALESCE(error_stack, ''), 4000) AS error_stack,
             url, user_email, status, priority, priority_score,
             priority_reasons, triaged_at, created_at, updated_at
      FROM feedback
      WHERE status IN ('open', 'in_progress')
      ORDER BY priority_score DESC, created_at DESC
      LIMIT 200
    `);
    logger.info(`[feedback-summary][${correlationId}] detail mód: ${items.length} lezáratlan tétel.`);
    return NextResponse.json({
      success: true,
      mode: 'detail',
      unresolvedCount: items.length,
      items,
      generatedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
    });
  }

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;

    // A tranzakciós advisory lock kizárja a párhuzamos cronpéldányok kettős küldését.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('feedback-critical-digest'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback_critical_digest_state (
        id INT PRIMARY KEY CHECK (id = 1),
        last_sent_on DATE,
        last_sent_at TIMESTAMPTZ
      )
    `);

    const { rows: summaryRows } = await client.query<CriticalSummaryRow>(`
      SELECT
        COUNT(*)::int                                                         AS critical_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS new_24h,
        MIN(created_at)                                                        AS oldest_created_at
      FROM feedback
      WHERE status IN ('open', 'in_progress')
        AND priority = 'critical'
    `);
    const summary = summaryRows[0] ?? { critical_count: 0, new_24h: 0, oldest_created_at: null };

    if (summary.critical_count === 0) {
      await client.query('COMMIT');
      transactionOpen = false;
      logger.info(`[feedback-summary][${correlationId}] Nincs lezáratlan kritikus feedback.`);
      return NextResponse.json({
        success: true,
        sent: false,
        reason: 'no_critical_feedback',
        criticalCount: 0,
        duration: Date.now() - startTime,
      });
    }

    if (!force) {
      const { rows: stateRows } = await client.query<{ already_sent: boolean }>(`
        SELECT EXISTS (
          SELECT 1
          FROM feedback_critical_digest_state
          WHERE id = 1
            AND last_sent_on = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Budapest')::date
        ) AS already_sent
      `);
      if (stateRows[0]?.already_sent) {
        await client.query('COMMIT');
        transactionOpen = false;
        return NextResponse.json({
          success: true,
          sent: false,
          reason: 'already_sent_today',
          criticalCount: summary.critical_count,
          duration: Date.now() - startTime,
        });
      }
    }

    const { rows: adminRows } = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE role = 'admin' AND active = true"
    );
    const oldestAgeDays = summary.oldest_created_at
      ? Math.max(0, Math.floor((Date.now() - new Date(summary.oldest_created_at).getTime()) / 86_400_000))
      : 0;
    const newText = summary.new_24h > 0 ? `, ebből ${summary.new_24h} új 24 órán belül` : '';
    const ageText = oldestAgeDays > 0 ? ` A legrégebbi ${oldestAgeDays} napos.` : '';

    const delivery = await sendPushNotificationToMultiple(
      adminRows.map((row) => row.id),
      {
        title: 'Kritikus feedbackek · napi emlékeztető',
        body: `${summary.critical_count} lezáratlan kritikus ticket${newText}.${ageText}`,
        tag: 'feedback-critical-digest',
        data: {
          type: 'reminder',
          url: '/admin?feedbackPriority=critical&feedbackStatus=unresolved#feedback-log',
        },
      }
    );

    // Csak tényleges kézbesítés után tekintjük elküldöttnek. Ha nincs aktív
    // subscription, az órán belüli következő cronfutás még próbálkozhat.
    if (delivery.sent === 0) {
      await client.query('COMMIT');
      transactionOpen = false;
      logger.error(
        `[feedback-summary][${correlationId}] Kritikus digest nem kézbesült: ` +
          `admins=${adminRows.length} failed=${delivery.failed} expired=${delivery.expired} skipped=${delivery.skipped}`
      );
      return NextResponse.json({
        success: true,
        sent: false,
        reason: 'no_push_delivery',
        criticalCount: summary.critical_count,
        duration: Date.now() - startTime,
      });
    }

    await client.query(`
      INSERT INTO feedback_critical_digest_state (id, last_sent_on, last_sent_at)
      VALUES (1, (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Budapest')::date, NOW())
      ON CONFLICT (id) DO UPDATE
      SET last_sent_on = EXCLUDED.last_sent_on,
          last_sent_at = EXCLUDED.last_sent_at
    `);
    await client.query('COMMIT');
    transactionOpen = false;

    const duration = Date.now() - startTime;
    logger.info(
      `[feedback-summary][${correlationId}] Kritikus digest: count=${summary.critical_count} ` +
        `sent=${delivery.sent} failed=${delivery.failed} duration=${duration}ms`
    );
    return NextResponse.json({
      success: true,
      sent: true,
      criticalCount: summary.critical_count,
      new24h: summary.new_24h,
      deliveredSubscriptions: delivery.sent,
      failedSubscriptions: delivery.failed,
      duration,
    });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});
