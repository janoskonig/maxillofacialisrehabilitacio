import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

const PREPARATORY_STAGES = ['STAGE_0', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4'];

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin', 'sebészorvos', 'fogpótlástanász'], async (req, { auth }) => {
  const pool = getDbPool();

  const tablesExist = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patient_episodes'
  `);
  if (tablesExist.rows.length === 0) {
    return NextResponse.json({ patients: [] });
  }

  const surgeonEmail = auth.role === 'sebészorvos' ? auth.email : null;
  let institutionFilter = '';
  const params: (string[] | string)[] = [PREPARATORY_STAGES];

  if (surgeonEmail) {
    const userRow = await pool.query(
      'SELECT intezmeny FROM users WHERE email = $1',
      [surgeonEmail]
    );
    const intezmeny = userRow.rows[0]?.intezmeny;
    if (intezmeny) {
      institutionFilter = ' AND p.beutalo_intezmeny = $2';
      params.push(intezmeny);
    }
  }

  const query = `
    WITH latest_stage AS (
      SELECT DISTINCT ON (e.patient_id, e.id)
        e.patient_id,
        e.id AS episode_id,
        s.stage_code,
        s.at AS stage_since
      FROM patient_episodes e
      JOIN stage_events s ON s.episode_id = e.id
      JOIN patients p ON p.id = e.patient_id
      WHERE e.status = 'open'
      ${institutionFilter}
      ORDER BY e.patient_id, e.id, s.at DESC
    ),
    prep AS (
      SELECT ls.patient_id, ls.stage_code, ls.stage_since
      FROM latest_stage ls
      WHERE ls.stage_code = ANY($1::varchar[])
    )
    SELECT DISTINCT ON (pr.patient_id)
      pr.patient_id AS "patientId",
      p.nev AS "patientName",
      pr.stage_code AS "stageCode",
      pr.stage_since AS "stageSince"
    FROM prep pr
    JOIN patients p ON p.id = pr.patient_id
    ORDER BY pr.patient_id, pr.stage_since ASC
  `;
  const result = await pool.query(query, params);

  const patients = result.rows.map((r: Record<string, unknown>) => ({
    patientId: r.patientId,
    patientName: r.patientName ?? 'Névtelen',
    stageCode: r.stageCode,
    stageSince: (r.stageSince as Date)?.toISOString?.() ?? r.stageSince,
  }));

  return NextResponse.json({ patients });
});
