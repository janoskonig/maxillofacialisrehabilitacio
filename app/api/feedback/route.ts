import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { optionalAuthHandler, roleHandler } from '@/lib/api/route-handler';
import { classifyFeedbackPriority, FEEDBACK_PRIORITY_LABELS } from '@/lib/feedback-priority';
import { sendPushNotificationToMultiple } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const POST = optionalAuthHandler(async (req, { correlationId, auth }) => {
  const userEmail = auth?.email || null;

  const body = await req.json();
  const { type, title, description, errorLog, errorStack } = body;

  if (!type || !description) {
    return NextResponse.json(
      { error: 'Type és description kötelező mezők' },
      { status: 400 }
    );
  }

  const validTypes = ['bug', 'error', 'crash', 'suggestion', 'other'];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: 'Érvénytelen type' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  const userAgent = req.headers.get('user-agent') || null;
  const referer = req.headers.get('referer') || null;
  const triage = classifyFeedbackPriority({ type, title, description, errorLog, errorStack });

  const result = await pool.query(
    `INSERT INTO feedback (
      user_email, type, title, description, error_log, error_stack, user_agent, url,
      priority, priority_score, priority_reasons, triaged_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
    RETURNING id, created_at, priority, priority_score`,
    [
      userEmail,
      type,
      title || null,
      description,
      errorLog || null,
      errorStack || null,
      userAgent,
      referer,
      triage.priority,
      triage.score,
      JSON.stringify(triage.reasons),
    ]
  );

  const ticket = result.rows[0];

  // Minden új ticket külön, azonnali push-t kap. A lock screenen szándékosan
  // nincs leírás, email vagy URL: ezek betegadatot is tartalmazhatnak.
  try {
    const { rows: adminRows } = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE role = 'admin' AND active = true"
    );
    const delivery = await sendPushNotificationToMultiple(
      adminRows.map((row) => row.id),
      {
        title: `Új feedback · ${FEEDBACK_PRIORITY_LABELS[triage.priority]}`,
        body: 'Új visszajelzés érkezett. A részletek az admin felületen nyithatók meg.',
        tag: `feedback-ticket-${ticket.id}`,
        data: {
          type: 'reminder',
          url: `/admin?feedback=${ticket.id}#feedback-log`,
          id: ticket.id,
        },
      }
    );
    const deliveryLog =
      `[feedback][${correlationId}] Azonnali admin push: ticket=${ticket.id} ` +
      `priority=${triage.priority} sent=${delivery.sent} failed=${delivery.failed} ` +
      `expired=${delivery.expired} skipped=${delivery.skipped}`;
    if (delivery.sent === 0 || delivery.failed > 0) logger.error(deliveryLog);
    else logger.info(deliveryLog);
  } catch (error) {
    // A feedback mentése fontosabb a pushnál: kézbesítési hiba miatt ne vesszen el.
    logger.error(
      `[feedback][${correlationId}] Azonnali admin push sikertelen: ticket=${ticket.id}`,
      error instanceof Error ? error.message : error
    );
  }

  return NextResponse.json(
    {
      success: true,
      id: ticket.id,
      createdAt: ticket.created_at,
      priority: ticket.priority,
      priorityScore: ticket.priority_score,
    },
    { status: 201 }
  );
});

export const GET = roleHandler(['admin'], async (req, { correlationId, auth }) => {
  const pool = getDbPool();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');
  const limit = parseInt(searchParams.get('limit') || '100');

  let query = `
    SELECT id, user_email, type, title, description, error_log, error_stack,
           user_agent, url, status, admin_response, admin_note,
           ai_draft_response, ai_draft_at, responded_at, responded_by,
           priority, priority_score, priority_reasons, triaged_at,
           created_at, updated_at
    FROM feedback
  `;
  const params: any[] = [];
  let paramIndex = 1;
  const filters: string[] = [];

  if (status) {
    if (status === 'unresolved') {
      filters.push("status IN ('open', 'in_progress')");
    } else {
      filters.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }
  }
  if (priority) {
    filters.push(`priority = $${paramIndex}`);
    params.push(priority);
    paramIndex++;
  }
  if (filters.length > 0) query += ` WHERE ${filters.join(' AND ')}`;

  query += ` ORDER BY priority_score DESC, created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query(query, params);

  return NextResponse.json({ feedback: result.rows });
});
