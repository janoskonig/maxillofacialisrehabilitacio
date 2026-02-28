import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler, authedHandler } from '@/lib/api/route-handler';
import type { StageCatalogEntry, ReasonType } from '@/lib/types';
import { stageCatalogCreateSchema } from '@/lib/admin-process-schemas';

const REASON_VALUES: ReasonType[] = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'];

export const dynamic = 'force-dynamic';

export const POST = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const body = await req.json();
  const auditReason =
    body.auditReason ?? req.nextUrl.searchParams.get('auditReason');
  const parsed = stageCatalogCreateSchema.safeParse({ ...body, auditReason });
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const data = parsed.data;

  const pool = getDbPool();
  try {
    const r = await pool.query(
      `INSERT INTO stage_catalog (code, reason, label_hu, order_index, is_terminal, default_duration_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING code, reason, label_hu as "labelHu", order_index as "orderIndex", is_terminal as "isTerminal", default_duration_days as "defaultDurationDays"`,
      [
        data.code,
        data.reason,
        data.labelHu,
        data.orderIndex,
        data.isTerminal ?? false,
        data.defaultDurationDays ?? null,
      ]
    );
    const row = r.rows[0];
    console.info('[admin] stage_catalog created', {
      code: row.code,
      reason: row.reason,
      by: auth.email ?? auth.userId,
      auditReason: data.auditReason,
    });
    return NextResponse.json({ stage: row });
  } catch (err: unknown) {
    const msg = String(err ?? '');
    if (msg.includes('idx_stage_catalog_reason_order') || msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json(
        { error: 'orderIndex ütközik ezen reason-nál. Válasszon másik orderIndex-et.', code: 'ORDER_INDEX_CONFLICT' },
        { status: 409 }
      );
    }
    throw err;
  }
});

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  const reason = req.nextUrl.searchParams.get('reason') as ReasonType | null;

  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_catalog'`
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ catalog: [] });
  }

  let query = `
    SELECT code, reason, label_hu as "labelHu", order_index as "orderIndex", is_terminal as "isTerminal", default_duration_days as "defaultDurationDays"
    FROM stage_catalog
  `;
  const params: string[] = [];
  if (reason && REASON_VALUES.includes(reason)) {
    query += ` WHERE reason = $1`;
    params.push(reason);
  }
  query += ` ORDER BY reason ASC, order_index ASC, code ASC`;

  const result = await pool.query(query, params);
  const catalog: StageCatalogEntry[] = result.rows.map((row) => ({
    code: row.code,
    reason: row.reason,
    labelHu: row.labelHu,
    orderIndex: row.orderIndex,
    isTerminal: row.isTerminal,
    defaultDurationDays: row.defaultDurationDays ?? null,
  }));

  return NextResponse.json({ catalog });
});
