import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  patientId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

/**
 * EüAK betekintési napló lekérdezése egy betegre (admin).
 * Az érintetti hozzáférési kérelmek (GDPR Art. 15) kiszolgálását támogatja.
 */
export const GET = roleHandler(['admin'], async (req) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    patientId: url.searchParams.get('patientId') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Érvénytelen lekérdezési paraméterek', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { patientId, from, to, limit } = parsed.data;

  const conditions = ['patient_id = $1'];
  const values: unknown[] = [patientId];
  if (from) {
    values.push(from);
    conditions.push(`accessed_at >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    conditions.push(`accessed_at < ($${values.length}::date + INTERVAL '1 day')`);
  }
  values.push(limit);

  const r = await getDbPool().query(
    `SELECT id, patient_id, actor_user_id, actor_email, actor_role, route, method,
            correlation_id, ip_address, accessed_at
     FROM patient_data_access_log
     WHERE ${conditions.join(' AND ')}
     ORDER BY accessed_at DESC
     LIMIT $${values.length}`,
    values,
  );

  return NextResponse.json({ accesses: r.rows });
});
