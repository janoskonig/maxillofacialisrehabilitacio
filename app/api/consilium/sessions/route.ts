import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { createSessionSchema, getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth }) => {
  const body = createSessionSchema.parse(await req.json());
  const institutionId = await getUserInstitution(auth);
  const pool = getDbPool();

  const result = await pool.query(
    `INSERT INTO consilium_sessions (title, institution_id, scheduled_at, status, created_by, updated_by)
     VALUES ($1, $2, $3, 'draft', $4, $4)
     RETURNING id, title, institution_id as "institutionId", scheduled_at as "scheduledAt", status, attendees`,
    [body.title, institutionId, body.scheduledAt, auth.email],
  );

  return NextResponse.json({ session: result.rows[0] }, { status: 201 });
});

