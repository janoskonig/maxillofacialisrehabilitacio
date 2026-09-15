/**
 * Elutasított (vagy visszavont) e-mailes időpont-ajánlat kötéseinek elengedése.
 *
 * A lemondás utáni ajánlat (POST /api/appointments/[id]/cancel-and-offer)
 * örökli a lemondott foglalás epizód/munkafázis/recall kontextusát, és a
 * munkafázis-kötést is átveszi. Ha a beteg végül minden ajánlott időpontot
 * elvet, ezeket a kötéseket vissza kell adni, különben a fázis „scheduled"
 * maradna egy halott sorhoz láncolva, és az aktív-foglalás őrök
 * (idx_appointments_unique_work_phase_active) örökre blokkolnák az
 * újrafoglalást.
 *
 * Epizód/fázis/recall nélküli („sima") ajánlatoknál nincs mit elengedni —
 * azok viselkedése változatlan (approval_status='rejected', státusz NULL).
 */

import type { PoolClient } from 'pg';
import {
  findEwpForAppointmentRevert,
  revertWorkPhaseLinkToPending,
} from './episode-work-phase-revert-lookup';

export interface RejectedOfferRow {
  id: string;
  episode_id: string | null;
  step_code: string | null;
  work_phase_id: string | null;
}

export interface ReleaseRejectedOfferResult {
  /** Igaz, ha a sor státusza cancelled_by_patient-re állt (volt mit elengedni). */
  released: boolean;
  workPhaseReopened: boolean;
}

export async function releaseRejectedOfferLinks(
  client: PoolClient,
  offer: RejectedOfferRow,
  actor = 'patient_email_link'
): Promise<ReleaseRejectedOfferResult> {
  const recallLinked = await client.query(
    `SELECT 1 FROM episode_tasks WHERE appointment_id = $1 AND task_type = 'recall_due' LIMIT 1`,
    [offer.id]
  );
  const hasLinks = Boolean(offer.episode_id || offer.work_phase_id || recallLinked.rows.length > 0);
  if (!hasLinks) return { released: false, workPhaseReopened: false };

  const updated = await client.query(
    `UPDATE appointments
        SET appointment_status = 'cancelled_by_patient',
            slot_intent_id = NULL
      WHERE id = $1 AND appointment_status IS NULL
      RETURNING id`,
    [offer.id]
  );
  if ((updated.rowCount ?? 0) > 0) {
    await client.query(
      `INSERT INTO appointment_status_events (appointment_id, old_status, new_status, created_by)
       VALUES ($1, NULL, 'cancelled_by_patient', $2)`,
      [offer.id, actor]
    );
  }

  let workPhaseReopened = false;
  if (offer.episode_id) {
    const ewp = await findEwpForAppointmentRevert(client, {
      episodeId: offer.episode_id,
      stepCode: offer.step_code ?? null,
      workPhaseId: offer.work_phase_id ?? null,
      appointmentId: offer.id,
    });
    if (ewp && ewp.appointmentId === offer.id && (ewp.status === 'scheduled' || ewp.status === 'completed')) {
      await revertWorkPhaseLinkToPending(client, {
        ewpId: ewp.id,
        episodeId: offer.episode_id,
        oldEwpStatus: ewp.status,
        changedBy: actor,
        reasonText: `a beteg elvetette az e-mailes időpont-ajánlatot (appointment ${offer.id}) — fázis visszanyitva`,
      });
      workPhaseReopened = true;
    }
    await client.query(
      `INSERT INTO scheduling_events (entity_type, entity_id, event_type) VALUES ('episode', $1, 'REPROJECT_INTENTS')`,
      [offer.episode_id]
    );
  }

  if (recallLinked.rows.length > 0) {
    await client.query(
      `UPDATE episode_tasks SET appointment_id = NULL, completed_at = NULL
        WHERE appointment_id = $1 AND task_type = 'recall_due'`,
      [offer.id]
    );
  }

  return { released: true, workPhaseReopened };
}
