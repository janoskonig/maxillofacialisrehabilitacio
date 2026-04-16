import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import { listOpenTasksForPatient } from '@/lib/user-tasks';
import { getCurrentEpisodeAndStage } from '@/lib/ohip14-stage';
import { getTimepointAvailability } from '@/lib/ohip14-timepoint-stage';
import { ohip14TimepointOptions } from '@/lib/types';
import {
  buildPortalTreatmentPlanSummary,
  treatmentPlanHasAnyRows,
  type PortalTreatmentPlanSummary,
} from '@/lib/patient-portal-treatment-plan';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const pool = getDbPool();

  const [dbTasks, ttResult, tervResult] = await Promise.all([
    listOpenTasksForPatient(patientId),
    pool.query<{ code: string; label_hu: string }>(`SELECT code, label_hu FROM treatment_types`),
    pool.query<{
      kezelesi_terv_felso: unknown;
      kezelesi_terv_also: unknown;
      kezelesi_terv_arcot_erinto: unknown;
    }>(
      `SELECT kezelesi_terv_felso, kezelesi_terv_also, kezelesi_terv_arcot_erinto
       FROM patient_treatment_plans WHERE patient_id = $1`,
      [patientId]
    ),
  ]);

  const codeToLabel = new Map(
    (ttResult.rows ?? []).map((r) => [r.code, r.label_hu] as const)
  );
  const tervRow = tervResult.rows?.[0];
  const treatmentPlan: PortalTreatmentPlanSummary = buildPortalTreatmentPlanSummary(
    tervRow?.kezelesi_terv_felso ?? [],
    tervRow?.kezelesi_terv_also ?? [],
    tervRow?.kezelesi_terv_arcot_erinto ?? [],
    codeToLabel
  );

  const items: Array<Record<string, unknown>> = dbTasks.map((t) => ({
    kind: 'task' as const,
    id: t.id,
    taskType: t.taskType,
    title: t.title,
    description: t.description,
    metadata: t.metadata,
    sourceMessageId: t.sourceMessageId,
    createdAt: t.createdAt,
    href: '/patient-portal/documents',
  }));

  try {
    const { episodeId: activeEpisodeId, stageCode, deliveryDate } = await getCurrentEpisodeAndStage(pool, patientId);
    const ohipRes = await pool.query(
      `SELECT timepoint FROM ohip14_responses
       WHERE patient_id = $1 AND (episode_id = $2 OR episode_id IS NULL OR $2 IS NULL)`,
      [patientId, activeEpisodeId]
    );
    const completedTps = Array.from(
      new Set(ohipRes.rows.map((r: { timepoint: string }) => r.timepoint))
    );
    const dd = deliveryDate;

    const pending = ohip14TimepointOptions.find((tp) => {
      const avail = getTimepointAvailability(tp.value, stageCode, dd);
      return avail.allowed && !completedTps.includes(tp.value);
    });

    if (pending) {
      items.unshift({
        kind: 'virtual_ohip',
        id: 'virtual:ohip14',
        taskType: 'ohip14',
        title: 'OHIP-14 kérdőív kitöltése',
        description: `${pending.label} – ${pending.description}`,
        href: '/patient-portal/ohip14',
        createdAt: new Date().toISOString(),
      });
    }
  } catch {
    // OHIP blokk opcionális
  }

  return NextResponse.json({
    success: true,
    items,
    treatmentPlan,
    treatmentPlanHasRows: treatmentPlanHasAnyRows(treatmentPlan),
  });
});
