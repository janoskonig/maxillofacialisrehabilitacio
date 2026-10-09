import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { EMAIL_REGEX, resolveLabQuoteRecipients } from '@/lib/email/lab-quote-recipients';
import { getLabQuoteTargets, isLabQuoteTargetId } from '@/lib/email/lab-quote-targets';

export const dynamic = 'force-dynamic';

export type LabQuoteRecipientSource = 'labor' | 'korabbi' | 'kollega';

export interface LabQuoteRecipientSuggestion {
  email: string;
  label: string | null;
  source: LabQuoteRecipientSource;
}

const MAX_RECENT = 10;

/**
 * Címzett-javaslatok az árajánlatkérő küldéséhez:
 * a beállított labor cím, a korábban használt címek (kimenő levélnapló),
 * és az aktív munkatársak. Szabad e-mail cím ettől függetlenül megadható.
 */
export const GET = authedHandler(async () => {
  const pool = getDbPool();
  const defaults = resolveLabQuoteRecipients();
  const targets = await getLabQuoteTargets();

  const suggestions: LabQuoteRecipientSuggestion[] = [];
  const seen = new Set<string>();
  const push = (rawEmail: unknown, label: string | null, source: LabQuoteRecipientSource): boolean => {
    const email = String(rawEmail ?? '').trim().toLowerCase();
    if (!email || seen.has(email) || !EMAIL_REGEX.test(email)) return false;
    seen.add(email);
    suggestions.push({ email, label, source });
    return true;
  };

  push(defaults.to, 'Labor (alapértelmezett)', 'labor');
  for (const target of targets) {
    if (target.email) push(target.email, target.recipientName, 'labor');
  }

  const [recent, users] = await Promise.all([
    pool.query(
      `SELECT recipient, metadata->>'cc' AS cc, MAX(created_at) AS last_sent
       FROM outbound_email_log
       WHERE email_type = 'lab_quote' AND status = 'sent'
       GROUP BY recipient, metadata->>'cc'
       ORDER BY last_sent DESC
       LIMIT 30`
    ),
    pool.query(
      `SELECT email, doktor_neve
       FROM users
       WHERE active = true AND email IS NOT NULL AND email <> ''
       ORDER BY doktor_neve NULLS LAST, email ASC`
    ),
  ]);

  let recentCount = 0;
  for (const row of recent.rows as Array<{ recipient: string; cc: string | null }>) {
    if (recentCount >= MAX_RECENT) break;
    if (push(row.recipient, 'Korábbi címzett', 'korabbi')) recentCount++;
    for (const cc of String(row.cc ?? '').split(',')) {
      if (recentCount >= MAX_RECENT) break;
      if (push(cc, 'Korábbi másolat', 'korabbi')) recentCount++;
    }
  }

  for (const row of users.rows as Array<{ email: string; doktor_neve: string | null }>) {
    push(row.email, row.doktor_neve?.trim() || null, 'kollega');
  }

  return NextResponse.json({ defaultTo: defaults.to, defaultCc: defaults.cc, suggestions, targets });
});

export const PUT = roleHandler(['admin', 'fogpótlástanász', 'beutalo_orvos', 'technikus'], async (req, { auth }) => {
  const body = await req.json();
  if (!isLabQuoteTargetId(body?.targetId) || typeof body?.email !== 'string') {
    return NextResponse.json({ error: 'Érvénytelen célcsoport vagy e-mail cím' }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();
  if (email.length > 255 || (email && !EMAIL_REGEX.test(email))) {
    return NextResponse.json({ error: 'Érvénytelen e-mail cím' }, { status: 400 });
  }
  await getDbPool().query(
    `INSERT INTO lab_quote_target_settings (target_id, email, updated_by)
     VALUES ($1, $2, $3) ON CONFLICT (target_id) DO UPDATE
     SET email = EXCLUDED.email, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [body.targetId, email || null, auth.email]
  );
  return NextResponse.json({ targets: await getLabQuoteTargets() });
});
