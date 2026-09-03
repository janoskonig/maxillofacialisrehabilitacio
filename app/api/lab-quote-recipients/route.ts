import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { EMAIL_REGEX, resolveLabQuoteRecipients } from '@/lib/email/lab-quote-recipients';

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

  return NextResponse.json({ defaultTo: defaults.to, defaultCc: defaults.cc, suggestions });
});
