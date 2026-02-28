import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

const PREPARATORY_STAGES = ['STAGE_0', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4'];

const FALLBACK_LABELS: Record<string, string> = {
  STAGE_0: 'Konzultációra vár',
  STAGE_1: 'Diagnosztika',
  STAGE_2: 'Terv & árajánlat',
  STAGE_3: 'Elfogadva / előkészítés',
  STAGE_4: 'Sebészi fázis',
};

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();

    // Stage labels from catalog (pick first reason's labels as canonical)
    let stageLabels: Record<string, string> = { ...FALLBACK_LABELS };
    try {
      const catalogResult = await pool.query(`
        SELECT DISTINCT ON (code) code, label_hu
        FROM stage_catalog
        WHERE code = ANY($1::varchar[])
        ORDER BY code, reason
      `, [PREPARATORY_STAGES]);
      for (const row of catalogResult.rows) {
        stageLabels[row.code] = row.label_hu;
      }
    } catch {
      // stage_catalog may not exist yet; fallback labels are fine
    }

    // 3. Patients in preparatory stages (grouped by stage_code)
    const allowedRoles = ['admin', 'sebészorvos', 'fogpótlástanász'];
    const canSeeStages = allowedRoles.includes(auth.role);

    let stagePatients: Record<string, Array<{ patientId: string; patientName: string; stageSince: string }>> = {};
    for (const sc of PREPARATORY_STAGES) {
      stagePatients[sc] = [];
    }

    if (canSeeStages) {
      try {
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

        const stageResult = await pool.query(`
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
            SELECT DISTINCT ON (ls.patient_id)
              ls.patient_id, ls.stage_code, ls.stage_since
            FROM latest_stage ls
            WHERE ls.stage_code = ANY($1::varchar[])
            ORDER BY ls.patient_id, ls.stage_since DESC
          )
          SELECT
            pr.patient_id AS "patientId",
            p.nev AS "patientName",
            pr.stage_code AS "stageCode",
            pr.stage_since AS "stageSince"
          FROM prep pr
          JOIN patients p ON p.id = pr.patient_id
          ORDER BY pr.stage_since ASC
        `, params);

        for (const row of stageResult.rows) {
          const code = row.stageCode as string;
          if (stagePatients[code]) {
            stagePatients[code].push({
              patientId: row.patientId,
              patientName: row.patientName ?? 'Névtelen',
              stageSince: (row.stageSince as Date)?.toISOString?.() ?? row.stageSince,
            });
          }
        }
      } catch {
        // patient_episodes table may not exist yet
      }
    }

    // Build columns
    const columns = PREPARATORY_STAGES.map((code) => ({
      id: code,
      label: stageLabels[code] || code,
      patients: stagePatients[code].map((p) => ({
        patientId: p.patientId,
        patientName: p.patientName,
        since: p.stageSince,
      })),
    }));

    return NextResponse.json({ columns });
  } catch (error) {
    logger.error('Error fetching patient pipeline:', error);
    return NextResponse.json(
      { error: 'Hiba a pipeline adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}
