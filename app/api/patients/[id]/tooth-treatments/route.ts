import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients/:id/tooth-treatments — list tooth treatments for patient
 */
export const GET = authedHandler(async (req, { params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tooth_treatments'`
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const ewpTable = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'episode_work_phases' LIMIT 1`
  );
  let mergedIntoCol = false;
  if (ewpTable.rows.length > 0) {
    const col = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
         AND column_name = 'merged_into_episode_work_phase_id' LIMIT 1`
    );
    mergedIntoCol = col.rows.length > 0;
  }

  const pathwayClosedExpr =
    ewpTable.rows.length === 0
      ? 'false AS "pathwayClosed"'
      : mergedIntoCol
        ? `COALESCE(
             (SELECT (prim.status IN ('completed', 'skipped'))
              FROM episode_work_phases ewp
              JOIN episode_work_phases prim ON prim.id = COALESCE(ewp.merged_into_episode_work_phase_id, ewp.id)
              WHERE ewp.tooth_treatment_id = tt.id
              LIMIT 1),
             false
           ) AS "pathwayClosed"`
        : `COALESCE(
             (SELECT (ewp.status IN ('completed', 'skipped'))
              FROM episode_work_phases ewp
              WHERE ewp.tooth_treatment_id = tt.id
              LIMIT 1),
             false
           ) AS "pathwayClosed"`;

  const result = await pool.query(
    `SELECT tt.id, tt.patient_id as "patientId", tt.tooth_number as "toothNumber",
            tt.treatment_code as "treatmentCode", tt.status, tt.episode_id as "episodeId",
            tt.notes, tt.created_by as "createdBy", tt.created_at as "createdAt",
            tt.completed_at as "completedAt",
            tc.label_hu as "labelHu",
            ${pathwayClosedExpr}
     FROM tooth_treatments tt
     JOIN tooth_treatment_catalog tc ON tt.treatment_code = tc.code
     WHERE tt.patient_id = $1
     ORDER BY tt.tooth_number, tc.sort_order, tt.created_at`,
    [patientId]
  );

  const rows = result.rows as Array<Record<string, unknown> & { id: string }>;
  const byTreatment = new Map<
    string,
    Array<{
      id: string;
      assigneeUserId: string;
      assigneeDisplayName: string;
      delegatedMode: 'staff' | 'external';
      externalLabel: string | null;
      createdAt: string;
    }>
  >();

  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const delRes = await pool.query(
      `SELECT t.id,
              t.metadata->>'toothTreatmentId' as tooth_treatment_id,
              t.assignee_user_id as assignee_user_id,
              t.metadata,
              t.created_at as created_at,
              u.doktor_neve as assignee_doktor_neve,
              u.email as assignee_email
       FROM user_tasks t
       LEFT JOIN users u ON u.id = t.assignee_user_id
       WHERE t.task_type = 'meeting_action'
         AND COALESCE(t.metadata->>'source', '') = 'tooth_treatment'
         AND t.status = 'open'
         AND t.metadata->>'toothTreatmentId' = ANY($1::text[])`,
      [ids]
    );
    for (const d of delRes.rows as Array<{
      id: string;
      tooth_treatment_id: string;
      assignee_user_id: string;
      metadata: Record<string, unknown> | null;
      created_at: Date;
      assignee_doktor_neve: string | null;
      assignee_email: string | null;
    }>) {
      const meta = d.metadata ?? {};
      const ext = typeof meta.externalAssigneeLabel === 'string' ? meta.externalAssigneeLabel.trim() : '';
      const modeRaw = meta.delegatedMode;
      const delegatedMode: 'staff' | 'external' =
        modeRaw === 'external' || ext.length > 0 ? 'external' : 'staff';
      const assigneeDisplayName =
        (d.assignee_doktor_neve && String(d.assignee_doktor_neve).trim()) ||
        (d.assignee_email && String(d.assignee_email).trim()) ||
        'Ismeretlen';
      const entry = {
        id: d.id,
        assigneeUserId: d.assignee_user_id,
        assigneeDisplayName,
        delegatedMode,
        externalLabel: delegatedMode === 'external' && ext ? ext : null,
        createdAt: new Date(d.created_at).toISOString(),
      };
      const tid = d.tooth_treatment_id;
      const list = byTreatment.get(tid) ?? [];
      list.push(entry);
      byTreatment.set(tid, list);
    }
  }

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      openDelegatedTasks: byTreatment.get(r.id) ?? [],
    })),
  });
});

/**
 * POST /api/patients/:id/tooth-treatments — add tooth treatment need
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  if (!['admin', 'beutalo_orvos', 'fogpótlástanász'].includes(auth.role)) {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
  }

  const pool = getDbPool();
  const patientId = params.id;
  const body = await req.json();

  const toothNumber = typeof body.toothNumber === 'number' ? body.toothNumber : parseInt(body.toothNumber, 10);
  const treatmentCode = (body.treatmentCode as string)?.trim();
  const notes = (body.notes as string)?.trim() || null;

  if (!toothNumber || toothNumber < 11 || toothNumber > 48) {
    return NextResponse.json({ error: 'Érvénytelen fogszám (11-48)' }, { status: 400 });
  }
  if (!treatmentCode) {
    return NextResponse.json({ error: 'treatment_code kötelező' }, { status: 400 });
  }

  const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tooth_treatments (patient_id, tooth_number, treatment_code, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, patient_id as "patientId", tooth_number as "toothNumber",
                 treatment_code as "treatmentCode", status, episode_id as "episodeId",
                 notes, created_by as "createdBy", created_at as "createdAt",
                 completed_at as "completedAt"`,
      [patientId, toothNumber, treatmentCode, notes, auth.userId || null]
    );

    const row = result.rows[0];
    const catalogResult = await pool.query(
      'SELECT label_hu as "labelHu" FROM tooth_treatment_catalog WHERE code = $1',
      [treatmentCode]
    );
    row.labelHu = catalogResult.rows[0]?.labelHu ?? treatmentCode;

    return NextResponse.json({ item: row }, { status: 201 });
  } catch (err: unknown) {
    const msg = String(err ?? '');
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json(
        { error: 'Ez a kezelési igény már létezik ennél a fognál (aktív állapotban).' },
        { status: 409 }
      );
    }
    throw err;
  }
});
