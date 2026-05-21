/**
 * Meglévő jövőbeli foglalás összekötése egy episode_work_phases sorral.
 * A slot / start_time nem változik — csak episode_id, step_code, work_phase_id linkek.
 */

import type { PoolClient } from 'pg';
import { isAppointmentActive } from './active-appointment';

export interface LinkAppointmentWorkPhaseParams {
  appointmentId: string;
  targetWorkPhaseId: string;
  /** Ha a foglalásnak még nincs episode_id-je (pl. páciens portál), kötelező. */
  episodeId?: string | null;
  reason?: string;
  changedBy: string;
}

export interface LinkAppointmentWorkPhaseResult {
  ok: true;
  workPhaseId: string;
  workPhaseCode: string;
  stepSeq: number | null;
  episodeId: string;
  cleanedStaleLink: boolean;
}

export interface LinkAppointmentWorkPhaseError {
  ok: false;
  status: number;
  error: string;
  linkedAppointmentId?: string;
}

export async function linkAppointmentToWorkPhase(
  client: PoolClient,
  params: LinkAppointmentWorkPhaseParams
): Promise<LinkAppointmentWorkPhaseResult | LinkAppointmentWorkPhaseError> {
  const { appointmentId, targetWorkPhaseId, changedBy } = params;
  const reasonInput = params.reason?.trim() ?? '';
  const reasonSuffix = reasonInput.length > 0 ? ` — ${reasonInput}` : '';

  const apptResult = await client.query(
    `SELECT a.id,
            a.patient_id          AS "patientId",
            a.episode_id          AS "episodeId",
            a.step_code           AS "stepCode",
            a.step_seq            AS "stepSeq",
            a.work_phase_id       AS "workPhaseId",
            a.pool,
            a.is_future           AS "isFuture",
            a.is_active_status    AS "isActiveStatus",
            a.appointment_status  AS "appointmentStatus"
     FROM appointments a
     WHERE a.id = $1
     FOR UPDATE OF a`,
    [appointmentId]
  );

  if (apptResult.rows.length === 0) {
    return { ok: false, status: 404, error: 'Foglalás nem található' };
  }

  const appt = apptResult.rows[0] as {
    id: string;
    patientId: string;
    episodeId: string | null;
    stepCode: string | null;
    stepSeq: number | null;
    workPhaseId: string | null;
    pool: string;
    isActiveStatus: boolean;
    appointmentStatus: string | null;
  };

  if (!appt.isActiveStatus) {
    return {
      ok: false,
      status: 400,
      error: `Inaktív / lemondott foglalás nem köthető munkafázishoz (status: ${appt.appointmentStatus ?? 'n/a'})`,
    };
  }

  const effectiveEpisodeId = appt.episodeId ?? params.episodeId ?? null;
  if (!effectiveEpisodeId) {
    return {
      ok: false,
      status: 400,
      error: 'Epizód megadása kötelező, ha a foglalás még nincs epizódhoz kötve',
    };
  }

  const targetResult = await client.query(
    `SELECT ewp.id,
            ewp.episode_id                         AS "episodeId",
            ewp.work_phase_code                    AS "workPhaseCode",
            ewp.pathway_order_index                AS "pathwayOrderIndex",
            ewp.pool,
            ewp.status,
            ewp.appointment_id                     AS "appointmentId",
            ewp.merged_into_episode_work_phase_id  AS "mergedIntoWorkPhaseId",
            pe.patient_id                          AS "patientId",
            ta.appointment_status                   AS "linkedAppointmentStatus",
            ta.id                                   AS "linkedAppointmentExistsId"
     FROM episode_work_phases ewp
     JOIN patient_episodes pe ON pe.id = ewp.episode_id
     LEFT JOIN appointments ta ON ta.id = ewp.appointment_id
     WHERE ewp.id = $1
     FOR UPDATE OF ewp`,
    [targetWorkPhaseId]
  );

  if (targetResult.rows.length === 0) {
    return { ok: false, status: 404, error: 'Cél munkafázis nem található' };
  }

  const target = targetResult.rows[0] as {
    id: string;
    episodeId: string;
    workPhaseCode: string;
    pathwayOrderIndex: number | null;
    pool: string;
    status: string;
    appointmentId: string | null;
    mergedIntoWorkPhaseId: string | null;
    patientId: string;
    linkedAppointmentStatus: string | null;
    linkedAppointmentExistsId: string | null;
  };

  if (target.patientId !== appt.patientId) {
    return { ok: false, status: 400, error: 'A foglalás és a munkafázis nem ugyanahhoz a beteghez tartozik' };
  }

  if (target.episodeId !== effectiveEpisodeId) {
    return { ok: false, status: 400, error: 'A cél munkafázis más epizódhoz tartozik' };
  }

  if (target.mergedIntoWorkPhaseId) {
    return {
      ok: false,
      status: 400,
      error: 'A cél munkafázis összevont (merged) sor — a fő (primary) sorhoz rendeld a foglalást.',
    };
  }

  if (target.status === 'skipped') {
    return {
      ok: false,
      status: 400,
      error: 'A cél munkafázis kihagyott (skipped) — előbb állítsd vissza pendingre.',
    };
  }

  const targetHasStaleLink =
    !!target.appointmentId &&
    target.appointmentId !== appointmentId &&
    (target.linkedAppointmentExistsId == null ||
      !isAppointmentActive(target.linkedAppointmentStatus));

  if (
    target.appointmentId &&
    target.appointmentId !== appointmentId &&
    !targetHasStaleLink
  ) {
    return {
      ok: false,
      status: 400,
      error: 'A cél munkafázishoz már tartozik egy másik aktív foglalás.',
      linkedAppointmentId: target.appointmentId,
    };
  }

  if (target.id === appt.workPhaseId && appt.episodeId === effectiveEpisodeId) {
    return { ok: false, status: 400, error: 'A foglalás már ehhez a fázishoz van rendelve' };
  }

  await client.query(`UPDATE appointments SET work_phase_id = NULL WHERE id = $1`, [appointmentId]);

  let targetCurrentStatus = target.status;

  if (targetHasStaleLink) {
    await client.query(
      `UPDATE episode_work_phases
       SET appointment_id = NULL,
           status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
       WHERE id = $1`,
      [target.id]
    );
    if (target.status === 'scheduled') {
      await client.query(
        `INSERT INTO episode_work_phase_audit
           (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          target.id,
          effectiveEpisodeId,
          'scheduled',
          'pending',
          changedBy,
          `stale appointment_id takarítása link előtt${reasonSuffix}`,
        ]
      );
      targetCurrentStatus = 'pending';
    }
  }

  const oldLinkedResult = await client.query(
    `SELECT id, work_phase_code AS "workPhaseCode", status
     FROM episode_work_phases
     WHERE episode_id = $1 AND appointment_id = $2 AND id <> $3`,
    [effectiveEpisodeId, appointmentId, target.id]
  );

  for (const oldEwp of oldLinkedResult.rows as Array<{ id: string; workPhaseCode: string; status: string }>) {
    const prevStatus = oldEwp.status;
    await client.query(
      `UPDATE episode_work_phases
       SET appointment_id = NULL,
           status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
       WHERE id = $1`,
      [oldEwp.id]
    );
    if (prevStatus === 'scheduled') {
      await client.query(
        `INSERT INTO episode_work_phase_audit
           (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          oldEwp.id,
          effectiveEpisodeId,
          'scheduled',
          'pending',
          changedBy,
          `appointment ${appointmentId} átkötve (${oldEwp.workPhaseCode} → ${target.workPhaseCode})${reasonSuffix}`,
        ]
      );
    }
  }

  const newTargetStatus =
    targetCurrentStatus === 'completed' ? 'completed' : 'scheduled';

  await client.query(
    `UPDATE episode_work_phases
     SET appointment_id = $1, status = $2
     WHERE id = $3`,
    [appointmentId, newTargetStatus, target.id]
  );

  if (targetCurrentStatus !== newTargetStatus) {
    await client.query(
      `INSERT INTO episode_work_phase_audit
         (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        target.id,
        effectiveEpisodeId,
        targetCurrentStatus,
        newTargetStatus,
        changedBy,
        `appointment ${appointmentId} munkafázishoz rendelve (${appt.stepCode ?? 'n/a'} → ${target.workPhaseCode})${reasonSuffix}`,
      ]
    );
  }

  await client.query(
    `UPDATE appointments
     SET episode_id = $1,
         step_code = $2,
         step_seq = $3,
         work_phase_id = $4,
         pool = $5
     WHERE id = $6`,
    [
      effectiveEpisodeId,
      target.workPhaseCode,
      target.pathwayOrderIndex,
      target.id,
      target.pool,
      appointmentId,
    ]
  );

  return {
    ok: true,
    workPhaseId: target.id,
    workPhaseCode: target.workPhaseCode,
    stepSeq: target.pathwayOrderIndex,
    episodeId: effectiveEpisodeId,
    cleanedStaleLink: targetHasStaleLink,
  };
}
