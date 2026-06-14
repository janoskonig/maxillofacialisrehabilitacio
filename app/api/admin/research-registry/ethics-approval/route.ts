import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  approvalNumber: z.string().min(1).max(64),
  approvedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  protocolCode: z.string().max(64).optional(),
});

/** List ethics approvals (admin). */
export const GET = roleHandler(['admin'], async () => {
  const r = await getDbPool().query(
    `SELECT ea.id, ea.approval_number, ea.approved_at, ea.expires_at, rp.protocol_code
     FROM ethics_approvals ea
     JOIN registry_protocols rp ON rp.id = ea.protocol_id
     ORDER BY ea.approved_at DESC`
  );
  return NextResponse.json({ approvals: r.rows });
});

/** Record an ethics approval (ETT TUKEB) for the research protocol (admin). */
export const POST = roleHandler(['admin'], async (req) => {
  const body = postSchema.parse(await req.json());
  const pool = getDbPool();

  const protocolCode = body.protocolCode ?? 'MAXREHAB_REGISTRY';
  const protocol = await pool.query(
    `SELECT id FROM registry_protocols WHERE protocol_code = $1`,
    [protocolCode]
  );
  if (protocol.rows.length === 0) {
    return NextResponse.json({ error: `Ismeretlen protokoll: ${protocolCode}` }, { status: 404 });
  }

  const r = await pool.query(
    `INSERT INTO ethics_approvals (protocol_id, approval_number, approved_at, expires_at)
     VALUES ($1, $2, $3::date, $4::date)
     RETURNING id`,
    [protocol.rows[0].id, body.approvalNumber, body.approvedAt, body.expiresAt ?? null]
  );

  return NextResponse.json({ success: true, id: r.rows[0].id });
});
