import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { ensurePatientVisibleForUser, getUserInstitution } from '@/lib/consilium';
import { insertUserTask } from '@/lib/user-tasks';
import { toothTreatmentDelegateSchema } from '@/lib/tooth-treatment-delegate';

export const dynamic = 'force-dynamic';

async function assertActiveUserInInstitution(
  pool: ReturnType<typeof getDbPool>,
  userId: string,
  institutionId: string,
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM users
     WHERE id = $1::uuid AND active = true
       AND btrim(coalesce(intezmeny, '')) = btrim(coalesce($2::text, ''))`,
    [userId, institutionId],
  );
  return r.rows.length > 0;
}

/**
 * POST /api/patients/:id/tooth-treatments/:treatmentId/delegate-task
 * Belső címzett: feladat a címzett Feladataim listáján. Külső: a taskOwnerUserId (alap: küldő) listáján,
 * leírásban a külső megnevezése.
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  if (!['admin', 'beutalo_orvos', 'fogpótlástanász'].includes(auth.role)) {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
  }

  const patientId = params.id;
  const treatmentId = params.treatmentId;
  const institutionId = await getUserInstitution(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Érvénytelen JSON' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = toothTreatmentDelegateSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.errors[0];
      return NextResponse.json(
        { error: first?.message ?? 'Érvénytelen adatok', details: e.flatten() },
        { status: 400 },
      );
    }
    throw e;
  }

  await ensurePatientVisibleForUser(patientId, auth, institutionId);

  const pool = getDbPool();

  const ttRes = await pool.query(
    `SELECT tt.id, tt.patient_id as "patientId", tt.tooth_number as "toothNumber",
            tt.treatment_code as "treatmentCode", tt.status,
            tc.label_hu as "labelHu"
     FROM tooth_treatments tt
     JOIN tooth_treatment_catalog tc ON tt.treatment_code = tc.code
     WHERE tt.id = $1::uuid AND tt.patient_id = $2::uuid`,
    [treatmentId, patientId],
  );
  if (ttRes.rows.length === 0) {
    return NextResponse.json({ error: 'Kezelés nem található' }, { status: 404 });
  }
  const tt = ttRes.rows[0] as {
    id: string;
    patientId: string;
    toothNumber: number;
    treatmentCode: string;
    status: string;
    labelHu: string;
  };
  if (tt.status === 'completed') {
    return NextResponse.json({ error: 'Befejezett kezeléshez nem lehet feladatot küldeni' }, { status: 400 });
  }

  const patientRow = await pool.query(`SELECT nev FROM patients WHERE id = $1::uuid`, [patientId]);
  const patientName = (patientRow.rows[0]?.nev as string | undefined)?.trim() || null;

  const dueAtDate = parsed.dueAt ? new Date(parsed.dueAt) : null;
  const dueAtHu =
    dueAtDate && !Number.isNaN(dueAtDate.getTime())
      ? dueAtDate.toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' })
      : null;

  let assigneeUserId: string;
  let title: string;
  let delegatedMode: 'staff' | 'external';
  let externalAssigneeLabel: string | undefined;

  if (parsed.mode === 'staff') {
    const ok = await assertActiveUserInInstitution(pool, parsed.assigneeUserId!, institutionId);
    if (!ok) {
      return NextResponse.json(
        { error: 'A címzett nem található, inaktív, vagy nem ehhez az intézményhez tartozik' },
        { status: 400 },
      );
    }
    assigneeUserId = parsed.assigneeUserId!;
    delegatedMode = 'staff';
    title = `Fog: ${tt.labelHu} (#${tt.toothNumber})`;
  } else {
    delegatedMode = 'external';
    externalAssigneeLabel = parsed.externalAssigneeLabel!;
    const ownerId = parsed.taskOwnerUserId?.trim() || auth.userId;
    const ownerOk = await assertActiveUserInInstitution(pool, ownerId, institutionId);
    if (!ownerOk) {
      return NextResponse.json(
        { error: 'A feladat felelőse nem található, inaktív, vagy nem ehhez az intézményhez tartozik' },
        { status: 400 },
      );
    }
    assigneeUserId = ownerId;
    title = `[Külső koordináció] Fog: ${tt.labelHu} (#${tt.toothNumber})`;
  }

  const descriptionParts = [
    patientName ? `Beteg: ${patientName}` : null,
    `Kezelés: ${tt.labelHu} (${tt.treatmentCode}), fogszám: ${tt.toothNumber}`,
    delegatedMode === 'external'
      ? `Külső címzett / kapcsolattartó: ${externalAssigneeLabel}`
      : null,
    dueAtHu ? `Határidő: ${dueAtHu}` : null,
    parsed.note && parsed.note.length > 0 ? `Megjegyzés: ${parsed.note}` : null,
  ].filter(Boolean);
  const description = descriptionParts.length > 0 ? descriptionParts.join('\n') : null;

  const patientChartPath = `/patients/${patientId}/view`;

  const task = await insertUserTask({
    assigneeKind: 'staff',
    assigneeUserId,
    assigneePatientId: null,
    patientId,
    taskType: 'meeting_action',
    title,
    description,
    metadata: {
      source: 'tooth_treatment',
      toothTreatmentId: treatmentId,
      patientId,
      toothNumber: tt.toothNumber,
      treatmentCode: tt.treatmentCode,
      treatmentLabelHu: tt.labelHu,
      delegatedMode,
      ...(patientName && { patientName }),
      ...(delegatedMode === 'external' && externalAssigneeLabel
        ? { externalAssigneeLabel }
        : {}),
      ...(parsed.dueAt && { dueAt: parsed.dueAt }),
      patientChartPath,
    },
    createdByUserId: auth.userId,
    dueAt: dueAtDate && !Number.isNaN(dueAtDate.getTime()) ? dueAtDate : null,
  });

  return NextResponse.json({
    success: true,
    task: { id: task.id, title: task.title },
  });
});
