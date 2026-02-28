import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rulesets — list all rulesets (with optional status filter)
 * POST /api/rulesets — create new DRAFT ruleset
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');

    let query = `SELECT id, version, status, rules, valid_from as "validFrom",
      created_at as "createdAt", created_by as "createdBy",
      published_at as "publishedAt", deprecated_at as "deprecatedAt"
      FROM stage_transition_rulesets`;
    const values: string[] = [];

    if (statusFilter) {
      query += ` WHERE status = $1`;
      values.push(statusFilter);
    }

    query += ` ORDER BY version DESC`;

    const result = await pool.query(query, values);
    const rulesets = result.rows.map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      rules: row.rules,
      validFrom: (row.validFrom as Date)?.toISOString?.() ?? null,
      createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
      createdBy: row.createdBy,
      publishedAt: (row.publishedAt as Date)?.toISOString?.() ?? null,
    }));

    return NextResponse.json({ rulesets });
  } catch (error) {
    logger.error('Error in GET /rulesets:', error);
    return NextResponse.json({ error: 'Hiba a rulesets lekérdezésekor' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Csak admin hozhat létre ruleseteket' }, { status: 403 });
    }

    const pool = getDbPool();
    const body = await request.json();
    const rules = body.rules;

    if (!rules || !Array.isArray(rules)) {
      return NextResponse.json({ error: 'rules tömb kötelező' }, { status: 400 });
    }

    const maxVersionRow = await pool.query(
      `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM stage_transition_rulesets`
    );
    const nextVersion = maxVersionRow.rows[0].next_version;

    const result = await pool.query(
      `INSERT INTO stage_transition_rulesets (version, status, rules, created_by)
       VALUES ($1, 'DRAFT', $2, $3)
       RETURNING id, version, status, rules, created_at as "createdAt", created_by as "createdBy"`,
      [nextVersion, JSON.stringify(rules), auth.email]
    );

    const row = result.rows[0];
    return NextResponse.json({
      ruleset: {
        id: row.id,
        version: row.version,
        status: row.status,
        rules: row.rules,
        createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
        createdBy: row.createdBy,
      },
    }, { status: 201 });
  } catch (error) {
    logger.error('Error in POST /rulesets:', error);
    return NextResponse.json({ error: 'Hiba a ruleset létrehozásakor' }, { status: 500 });
  }
}
