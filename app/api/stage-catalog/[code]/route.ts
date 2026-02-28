import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { stageCatalogPatchSchema } from '@/lib/admin-process-schemas';
import { logger } from '@/lib/logger';

const REASON_VALUES = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'];

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/stage-catalog/[code]?reason=... — update stage. code és reason immutable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const code = decodeURIComponent(params.code);
    const reason = request.nextUrl.searchParams.get('reason');
    if (!reason || !REASON_VALUES.includes(reason)) {
      return NextResponse.json(
        { error: 'reason query param kötelező és érvényes értékű' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const auditReason =
      body.auditReason ?? request.nextUrl.searchParams.get('auditReason');
    const parsed = stageCatalogPatchSchema.safeParse({ ...body, auditReason });
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const data = parsed.data;

    const pool = getDbPool();

    const beforeResult = await pool.query(
      `SELECT code, reason, label_hu, order_index, is_terminal, default_duration_days
       FROM stage_catalog WHERE code = $1 AND reason = $2`,
      [code, reason]
    );
    if (beforeResult.rows.length === 0) {
      return NextResponse.json({ error: 'Stádium nem található' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.labelHu !== undefined) {
      updates.push(`label_hu = $${idx}`);
      values.push(data.labelHu);
      idx++;
    }
    if (data.orderIndex !== undefined) {
      updates.push(`order_index = $${idx}`);
      values.push(data.orderIndex);
      idx++;
    }
    if (data.isTerminal !== undefined) {
      updates.push(`is_terminal = $${idx}`);
      values.push(data.isTerminal);
      idx++;
    }
    if (data.defaultDurationDays !== undefined) {
      updates.push(`default_duration_days = $${idx}`);
      values.push(data.defaultDurationDays);
      idx++;
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nincs módosítandó mező' }, { status: 400 });
    }

    values.push(code, reason);

    try {
      await pool.query(
        `UPDATE stage_catalog SET ${updates.join(', ')} WHERE code = $${idx} AND reason = $${idx + 1}`,
        values
      );
    } catch (err: unknown) {
      const msg = String(err ?? '');
      if (msg.includes('idx_stage_catalog_reason_order') || msg.includes('unique') || msg.includes('duplicate')) {
        return NextResponse.json(
          { error: 'orderIndex ütközik ezen reason-nál.', code: 'ORDER_INDEX_CONFLICT' },
          { status: 409 }
        );
      }
      throw err;
    }

    console.info('[admin] stage_catalog updated', {
      code,
      reason,
      by: auth.email ?? auth.userId,
      auditReason: data.auditReason,
    });

    const afterResult = await pool.query(
      `SELECT code, reason, label_hu as "labelHu", order_index as "orderIndex", is_terminal as "isTerminal", default_duration_days as "defaultDurationDays"
       FROM stage_catalog WHERE code = $1 AND reason = $2`,
      [code, reason]
    );

    return NextResponse.json({ stage: afterResult.rows[0] });
  } catch (error) {
    logger.error('Error updating stage catalog:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stádium módosításakor' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/stage-catalog/[code]?reason=... — delete stage. reason kötelező.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const code = decodeURIComponent(params.code);
    const reason = request.nextUrl.searchParams.get('reason');
    if (!reason || !REASON_VALUES.includes(reason)) {
      return NextResponse.json(
        { error: 'reason query param kötelező és érvényes értékű' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    const r = await pool.query(
      `DELETE FROM stage_catalog WHERE code = $1 AND reason = $2 RETURNING code`,
      [code, reason]
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Stádium nem található' }, { status: 404 });
    }

    const auditReason = request.nextUrl.searchParams.get('auditReason');
    console.info('[admin] stage_catalog deleted', {
      code,
      reason,
      by: auth.email ?? auth.userId,
      auditReason: auditReason ?? 'nincs',
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    logger.error('Error deleting stage catalog:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stádium törlésekor' },
      { status: 500 }
    );
  }
}
