import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { ensurePatientVisibleForUser, getUserInstitution } from '@/lib/consilium';
import { insertUserTask } from '@/lib/user-tasks';
import { assertAssignableStaffUser } from '@/lib/task-assignee';
import { workPhaseDelegateSchema } from '@/lib/work-phase-delegate';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/work-phases/:workPhaseId/delegate-task
 * Egy munkafázishoz Feladataim feladat (opcionálisan felosztva több tételre).
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  if (!['admin', 'beutalo_orvos', 'fogpótlástanász'].includes(auth.role)) {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
  }

  const episodeId = params.id;
  const workPhaseId = params.workPhaseId;
  const institutionId = await getUserInstitution(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Érvénytelen JSON' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = workPhaseDelegateSchema.parse(body);
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

  const pool = getDbPool();

  const wpRes = await pool.query(
    `SELECT ewp.id, ewp.episode_id as "episodeId", ewp.work_phase_code as "workPhaseCode",
            ewp.custom_label as "customLabel", ewp.status, ewp.pool,
            pe.patient_id as "patientId"
     FROM episode_work_phases ewp
     JOIN patient_episodes pe ON pe.id = ewp.episode_id
     WHERE ewp.id = $1::uuid AND ewp.episode_id = $2::uuid`,
    [workPhaseId, episodeId],
  );
  if (wpRes.rows.length === 0) {
    return NextResponse.json({ error: 'Munkafázis nem található' }, { status: 404 });
  }

  const wp = wpRes.rows[0] as {
    id: string;
    episodeId: string;
    workPhaseCode: string;
    customLabel: string | null;
    status: string;
    pool: string;
    patientId: string;
  };

  if (wp.status === 'completed' || wp.status === 'skipped') {
    return NextResponse.json(
      { error: 'Befejezett vagy átugrott munkafázishoz nem lehet feladatot küldeni' },
      { status: 400 },
    );
  }

  await ensurePatientVisibleForUser(wp.patientId, auth, institutionId);

  const catalogRow = await pool.query(
    `SELECT label_hu FROM work_phase_catalog WHERE work_phase_code = $1`,
    [wp.workPhaseCode],
  );
  const catalogLabel = (catalogRow.rows[0]?.label_hu as string | undefined)?.trim();
  const phaseLabel =
    (wp.customLabel && wp.customLabel.trim()) ||
    catalogLabel ||
    wp.workPhaseCode.replace(/_/g, ' ');

  const patientRow = await pool.query(`SELECT nev FROM patients WHERE id = $1::uuid`, [wp.patientId]);
  const patientName = (patientRow.rows[0]?.nev as string | undefined)?.trim() || null;

  const dueAtDate = parsed.dueAt ? new Date(parsed.dueAt) : null;
  const dueAtHu =
    dueAtDate && !Number.isNaN(dueAtDate.getTime())
      ? dueAtDate.toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' })
      : null;

  const patientChartPath = `/patients/${wp.patientId}/view`;
  const stagesPath = `/patients/${wp.patientId}/stages`;

  async function resolveAssignee(
    itemAssigneeId: string | undefined,
    defaultStaffId: string | undefined,
    defaultOwnerId: string,
  ): Promise<{ assigneeUserId: string; delegatedMode: 'staff' | 'external'; externalLabel?: string }> {
    if (parsed.mode === 'staff') {
      const targetId = itemAssigneeId ?? defaultStaffId;
      if (!targetId) {
        throw new Error('MISSING_ASSIGNEE');
      }
      const ok = await assertAssignableStaffUser(pool, targetId, institutionId, auth.role);
      if (!ok) {
        throw new Error('INVALID_ASSIGNEE');
      }
      return { assigneeUserId: targetId, delegatedMode: 'staff' };
    }

    const ownerId = defaultOwnerId;
    const ok = await assertAssignableStaffUser(pool, ownerId, institutionId, auth.role);
    if (!ok) {
      throw new Error('INVALID_OWNER');
    }
    return {
      assigneeUserId: ownerId,
      delegatedMode: 'external',
      externalLabel: parsed.externalAssigneeLabel!,
    };
  }

  const splitGroupId = parsed.splitItems?.length ? randomUUID() : null;
  const createdTasks: Array<{ id: string; title: string }> = [];

  try {
    if (parsed.splitItems && parsed.splitItems.length > 0) {
      const defaultOwnerId = (parsed.taskOwnerUserId?.trim() || auth.userId).trim();
      const defaultStaffId = parsed.assigneeUserId;

      for (let i = 0; i < parsed.splitItems.length; i++) {
        const item = parsed.splitItems[i];
        const { assigneeUserId, delegatedMode, externalLabel } = await resolveAssignee(
          item.assigneeUserId,
          defaultStaffId,
          defaultOwnerId,
        );

        const title =
          delegatedMode === 'external'
            ? `[Külső] ${phaseLabel}: ${item.label}`
            : `${phaseLabel}: ${item.label}`;

        const descriptionParts = [
          patientName ? `Beteg: ${patientName}` : null,
          `Munkafázis: ${phaseLabel}`,
          splitGroupId ? `Felosztás (${i + 1}/${parsed.splitItems.length})` : null,
          delegatedMode === 'external' && externalLabel
            ? `Külső címzett: ${externalLabel}`
            : null,
          dueAtHu ? `Határidő: ${dueAtHu}` : null,
          parsed.note && parsed.note.length > 0 ? `Megjegyzés: ${parsed.note}` : null,
        ].filter(Boolean);

        const task = await insertUserTask({
          assigneeKind: 'staff',
          assigneeUserId,
          assigneePatientId: null,
          patientId: wp.patientId,
          taskType: 'meeting_action',
          title,
          description: descriptionParts.length > 0 ? descriptionParts.join('\n') : null,
          metadata: {
            source: 'work_phase',
            workPhaseId,
            episodeId,
            phaseLabel,
            workPhaseCode: wp.workPhaseCode,
            delegatedMode,
            ...(patientName && { patientName }),
            ...(delegatedMode === 'external' && externalLabel ? { externalAssigneeLabel: externalLabel } : {}),
            ...(parsed.dueAt && { dueAt: parsed.dueAt }),
            ...(splitGroupId && {
              splitGroupId,
              splitIndex: i,
              splitTotal: parsed.splitItems.length,
              splitItemLabel: item.label,
            }),
            patientChartPath,
            stagesPath,
          },
          createdByUserId: auth.userId,
          dueAt: dueAtDate && !Number.isNaN(dueAtDate.getTime()) ? dueAtDate : null,
        });
        createdTasks.push({ id: task.id, title: task.title });
      }
    } else {
      let assigneeUserId: string;
      let delegatedMode: 'staff' | 'external';
      let externalAssigneeLabel: string | undefined;

      if (parsed.mode === 'staff') {
        const ok = await assertAssignableStaffUser(
          pool,
          parsed.assigneeUserId!,
          institutionId,
          auth.role,
        );
        if (!ok) {
          return NextResponse.json(
            { error: 'A címzett nem található, inaktív, technikus, vagy nem kiosztható' },
            { status: 400 },
          );
        }
        assigneeUserId = parsed.assigneeUserId!;
        delegatedMode = 'staff';
      } else {
        delegatedMode = 'external';
        externalAssigneeLabel = parsed.externalAssigneeLabel!;
        const ownerId = parsed.taskOwnerUserId?.trim() || auth.userId;
        const ownerOk = await assertAssignableStaffUser(pool, ownerId, institutionId, auth.role);
        if (!ownerOk) {
          return NextResponse.json(
            { error: 'A feladat felelőse nem található, inaktív, vagy nem kiosztható' },
            { status: 400 },
          );
        }
        assigneeUserId = ownerId;
      }

      const title =
        delegatedMode === 'external'
          ? `[Külső koordináció] ${phaseLabel}`
          : phaseLabel;

      const descriptionParts = [
        patientName ? `Beteg: ${patientName}` : null,
        `Munkafázis: ${phaseLabel} (${wp.workPhaseCode})`,
        delegatedMode === 'external'
          ? `Külső címzett / kapcsolattartó: ${externalAssigneeLabel}`
          : null,
        dueAtHu ? `Határidő: ${dueAtHu}` : null,
        parsed.note && parsed.note.length > 0 ? `Megjegyzés: ${parsed.note}` : null,
      ].filter(Boolean);

      const task = await insertUserTask({
        assigneeKind: 'staff',
        assigneeUserId,
        assigneePatientId: null,
        patientId: wp.patientId,
        taskType: 'meeting_action',
        title,
        description: descriptionParts.length > 0 ? descriptionParts.join('\n') : null,
        metadata: {
          source: 'work_phase',
          workPhaseId,
          episodeId,
          phaseLabel,
          workPhaseCode: wp.workPhaseCode,
          delegatedMode,
          ...(patientName && { patientName }),
          ...(delegatedMode === 'external' && externalAssigneeLabel
            ? { externalAssigneeLabel }
            : {}),
          ...(parsed.dueAt && { dueAt: parsed.dueAt }),
          patientChartPath,
          stagesPath,
        },
        createdByUserId: auth.userId,
        dueAt: dueAtDate && !Number.isNaN(dueAtDate.getTime()) ? dueAtDate : null,
      });
      createdTasks.push({ id: task.id, title: task.title });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'MISSING_ASSIGNEE' || msg === 'INVALID_ASSIGNEE') {
      return NextResponse.json(
        { error: 'A címzett nem található, inaktív, technikus, vagy nem kiosztható' },
        { status: 400 },
      );
    }
    if (msg === 'INVALID_OWNER') {
      return NextResponse.json(
        { error: 'A feladat felelőse nem található, inaktív, vagy nem kiosztható' },
        { status: 400 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    success: true,
    tasks: createdTasks,
    split: !!splitGroupId,
  });
});
