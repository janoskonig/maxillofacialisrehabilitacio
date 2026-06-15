import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { sendFeedbackResponseEmail } from '@/lib/email';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

/**
 * PUT /api/feedback/[id]
 *
 * Admin ügyintézés egy visszajelzés-ticketen. Bármelyik mező opcionális:
 *  - status         : állapotváltás (open / in_progress / resolved / closed)
 *  - adminResponse  : a bejelentőnek szánt válasz (responded_at/by frissül)
 *  - adminNote      : belső jegyzet (sosem megy ki a bejelentőnek)
 *  - notifyReporter : ha true ÉS van adminResponse ÉS a ticketnek van user_email-je,
 *                     emailt küld a bejelentőnek a válasszal (alap: true)
 */
export const PUT = roleHandler(['admin'], async (req, { auth, params, correlationId }) => {
  const { id } = params;
  const body = await req.json();
  const { status, adminResponse, adminNote, notifyReporter = true } = body;

  // Legalább egy értelmes mezőt módosítani kell.
  const hasStatus = typeof status === 'string';
  const hasResponse = typeof adminResponse === 'string';
  const hasNote = typeof adminNote === 'string';
  if (!hasStatus && !hasResponse && !hasNote) {
    return NextResponse.json(
      { error: 'Nincs módosítandó mező (status, adminResponse vagy adminNote)' },
      { status: 400 }
    );
  }

  if (hasStatus && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Érvénytelen status' }, { status: 400 });
  }

  // Dinamikus UPDATE az átadott mezőkből.
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (hasStatus) {
    sets.push(`status = $${i++}`);
    values.push(status);
  }
  if (hasResponse) {
    const trimmed = adminResponse.trim();
    sets.push(`admin_response = $${i++}`);
    values.push(trimmed || null);
    // responded_at/by csak akkor frissül, ha tényleg van válaszszöveg.
    if (trimmed) {
      sets.push(`responded_at = CURRENT_TIMESTAMP`);
      sets.push(`responded_by = $${i++}`);
      values.push(auth.email);
    }
  }
  if (hasNote) {
    sets.push(`admin_note = $${i++}`);
    values.push(adminNote.trim() || null);
  }
  sets.push(`updated_at = CURRENT_TIMESTAMP`);

  values.push(id);

  const pool = getDbPool();
  const result = await pool.query(
    `UPDATE feedback
        SET ${sets.join(', ')}
      WHERE id = $${i}
      RETURNING id, user_email, type, title, description, status,
                admin_response, admin_note, responded_at, responded_by, updated_at`,
    values
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Feedback nem található' }, { status: 404 });
  }

  const ticket = result.rows[0];

  // Email a bejelentőnek, ha kértük, van válasz és van címzett.
  let emailSent = false;
  const responseText = hasResponse ? adminResponse.trim() : '';
  if (notifyReporter && responseText && ticket.user_email) {
    try {
      await sendFeedbackResponseEmail({
        to: ticket.user_email,
        feedbackId: ticket.id,
        type: ticket.type,
        title: ticket.title,
        originalDescription: ticket.description,
        response: responseText,
        status: ticket.status,
      });
      emailSent = true;
    } catch (error) {
      // A válasz mentve maradt; csak az email-küldés bukott — ne dőljön el a kérés.
      logger.error(
        `[feedback][${correlationId}] Válasz-email hiba a(z) ${ticket.id} ticketnél:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return NextResponse.json({ success: true, feedback: ticket, emailSent });
});
