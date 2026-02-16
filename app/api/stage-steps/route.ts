import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

function requireAdmin(auth: { role?: string } | null) {
  if (!auth) return { error: 'Bejelentkezés szükséges', status: 401 as const };
  if (auth.role !== 'admin') return { error: 'Nincs jogosultság', status: 403 as const };
  return null;
}

/**
 * GET /api/stage-steps?stageCode=STAGE_5 — list stage_steps, determinisztikus ORDER BY
 * Admin-only.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    const err = requireAdmin(auth);
    if (err) return NextResponse.json({ error: err.error }, { status: err.status });

    const pool = getDbPool();
    const stageCode = request.nextUrl.searchParams.get('stageCode');

    const tableExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_steps'`
    );
    if (tableExists.rows.length === 0) {
      return NextResponse.json({ items: [] });
    }

    let query = `
      SELECT ss.stage_code as "stageCode", ss.step_code as "stepCode", ss.order_index as "orderIndex",
             sc.label_hu as "stepLabelHu",
             (SELECT label_hu FROM stage_catalog WHERE code = ss.stage_code LIMIT 1) as "stageLabelHu"
      FROM stage_steps ss
      LEFT JOIN step_catalog sc ON sc.step_code = ss.step_code
    `;
    const params: string[] = [];
    if (stageCode && stageCode.trim()) {
      query += ` WHERE ss.stage_code = $1`;
      params.push(stageCode.trim());
    }
    query += ` ORDER BY ss.stage_code ASC, ss.order_index ASC, ss.step_code ASC`;

    const result = await pool.query(query, params);
    const items = result.rows.map((row) => ({
      stageCode: row.stageCode,
      stepCode: row.stepCode,
      orderIndex: row.orderIndex ?? 0,
      stepLabelHu: row.stepLabelHu ?? row.stepCode,
      stageLabelHu: row.stageLabelHu ?? null,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error('Error fetching stage-steps:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stage-steps lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stage-steps — új kapcsolat: { stageCode, stepCode, orderIndex }
 * Admin-only. stage_code validáció: ∈ (SELECT DISTINCT code FROM stage_catalog)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    const err = requireAdmin(auth);
    if (err) return NextResponse.json({ error: err.error }, { status: err.status });

    const body = await request.json();
    const stageCode = typeof body.stageCode === 'string' ? body.stageCode.trim() : '';
    const stepCode = typeof body.stepCode === 'string' ? body.stepCode.trim() : '';
    const orderIndex = typeof body.orderIndex === 'number' ? body.orderIndex : 0;

    if (!stageCode || !stepCode) {
      return NextResponse.json(
        { error: 'stageCode és stepCode kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // stage_code validáció: ∈ (SELECT DISTINCT code FROM stage_catalog)
    const validStage = await pool.query(
      `SELECT 1 FROM stage_catalog WHERE code = $1 LIMIT 1`,
      [stageCode]
    );
    if (validStage.rows.length === 0) {
      return NextResponse.json(
        { error: `Érvénytelen stage_code: ${stageCode}. A stage_code a stage_catalog-ban kell szerepelnie.` },
        { status: 400 }
      );
    }

    // step_code validáció: FK step_catalog
    const validStep = await pool.query(
      `SELECT 1 FROM step_catalog WHERE step_code = $1 LIMIT 1`,
      [stepCode]
    );
    if (validStep.rows.length === 0) {
      return NextResponse.json(
        { error: `Érvénytelen step_code: ${stepCode}. A step_code a step_catalog-ban kell szerepelnie.` },
        { status: 400 }
      );
    }

    try {
      await pool.query(
        `INSERT INTO stage_steps (stage_code, step_code, order_index)
         VALUES ($1, $2, $3)`,
        [stageCode, stepCode, orderIndex]
      );
      const row = await pool.query(
        `SELECT ss.stage_code as "stageCode", ss.step_code as "stepCode", ss.order_index as "orderIndex",
                sc.label_hu as "stepLabelHu"
         FROM stage_steps ss
         LEFT JOIN step_catalog sc ON sc.step_code = ss.step_code
         WHERE ss.stage_code = $1 AND ss.step_code = $2`,
        [stageCode, stepCode]
      );
      return NextResponse.json({ item: row.rows[0] ?? { stageCode, stepCode, orderIndex, stepLabelHu: stepCode } });
    } catch (dbErr: unknown) {
      const msg = String(dbErr ?? '');
      if (msg.includes('uq_stage_steps_stage_order') || msg.includes('unique') || msg.includes('duplicate')) {
        return NextResponse.json(
          { error: 'orderIndex ütközik ezen stage-en belül. Válasszon másik orderIndex-et.', code: 'ORDER_INDEX_CONFLICT' },
          { status: 409 }
        );
      }
      if (msg.includes('stage_steps_pkey') || msg.includes('duplicate key')) {
        return NextResponse.json(
          { error: 'Ez a kapcsolat (stage_code, step_code) már létezik.', code: 'ALREADY_EXISTS' },
          { status: 409 }
        );
      }
      throw dbErr;
    }
  } catch (error) {
    console.error('Error creating stage-step:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kapcsolat létrehozásakor' },
      { status: 500 }
    );
  }
}
