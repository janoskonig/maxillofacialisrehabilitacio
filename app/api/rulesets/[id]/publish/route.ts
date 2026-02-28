import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/rulesets/:id/publish — publish a DRAFT ruleset.
 * Atomically: old PUBLISHED → DEPRECATED, target DRAFT → PUBLISHED.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Csak admin publikálhat ruleseteket' }, { status: 403 });
    }

    const rulesetId = params.id;
    const pool = getDbPool();

    const check = await pool.query(
      `SELECT id, version, status FROM stage_transition_rulesets WHERE id = $1`,
      [rulesetId]
    );
    if (check.rows.length === 0) {
      return NextResponse.json({ error: 'Ruleset nem található' }, { status: 404 });
    }
    if (check.rows[0].status !== 'DRAFT') {
      return NextResponse.json(
        { error: `Csak DRAFT státuszú ruleset publikálható (jelenlegi: ${check.rows[0].status})` },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE stage_transition_rulesets
         SET status = 'DEPRECATED', deprecated_at = CURRENT_TIMESTAMP
         WHERE status = 'PUBLISHED'`
      );

      await client.query(
        `UPDATE stage_transition_rulesets
         SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP, valid_from = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [rulesetId]
      );

      await client.query('COMMIT');

      const result = await pool.query(
        `SELECT id, version, status, rules, valid_from as "validFrom",
          created_at as "createdAt", created_by as "createdBy",
          published_at as "publishedAt"
         FROM stage_transition_rulesets WHERE id = $1`,
        [rulesetId]
      );

      const row = result.rows[0];
      return NextResponse.json({
        ruleset: {
          id: row.id,
          version: row.version,
          status: row.status,
          rules: row.rules,
          validFrom: (row.validFrom as Date)?.toISOString?.() ?? null,
          createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
          createdBy: row.createdBy,
          publishedAt: (row.publishedAt as Date)?.toISOString?.() ?? null,
        },
      });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error in PATCH /rulesets/:id/publish:', error);
    return NextResponse.json(
      { error: 'Hiba történt a ruleset publikálásakor' },
      { status: 500 }
    );
  }
}
