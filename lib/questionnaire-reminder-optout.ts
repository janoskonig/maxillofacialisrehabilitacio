import type { Pool, PoolClient } from 'pg';

/**
 * Kérdőív-emlékeztetők leiratkozása (patients.kerdoiv_emlekezteto_tiltva, migr. 116).
 *
 * Ha be van kapcsolva, a beteg NEM kap kérdőív-kitöltésre buzdító e-mailt,
 * push értesítést és portál-feladatot (OHIP-14: lib/ohip14-reminders.ts,
 * önkitöltés: lib/patient-selffill-reminders.ts), és a kezelőorvoshoz sem
 * eszkalálódik a ki nem töltés. Önkéntesen továbbra is kitöltheti.
 */

export interface QuestionnaireReminderOptOut {
  optedOut: boolean;
  changedAt: string | null;
  /** 'patient' vagy a személyzeti felhasználó e-mail címe. */
  changedBy: string | null;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

export async function getQuestionnaireReminderOptOut(
  db: Queryable,
  patientId: string,
): Promise<QuestionnaireReminderOptOut | null> {
  const res = await db.query(
    `SELECT kerdoiv_emlekezteto_tiltva AS opted_out,
            kerdoiv_emlekezteto_tiltva_at AS changed_at,
            kerdoiv_emlekezteto_tiltva_by AS changed_by
       FROM patients WHERE id = $1`,
    [patientId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    optedOut: row.opted_out === true,
    changedAt: row.changed_at ? new Date(row.changed_at).toISOString() : null,
    changedBy: row.changed_by ?? null,
  };
}

export async function setQuestionnaireReminderOptOut(
  db: Queryable,
  patientId: string,
  optedOut: boolean,
  changedBy: string,
): Promise<QuestionnaireReminderOptOut | null> {
  // set_config(...): preferencia, nem klinikai adat → ne bumpolja az optimista
  // zár updated_at tokenjét (lásd database/migrations/062).
  const res = await db.query(
    `UPDATE patients
        SET kerdoiv_emlekezteto_tiltva = $2,
            kerdoiv_emlekezteto_tiltva_at = NOW(),
            kerdoiv_emlekezteto_tiltva_by = $3
      WHERE id = $1 AND set_config('app.skip_updated_at','on',true) IS NOT NULL
      RETURNING kerdoiv_emlekezteto_tiltva AS opted_out,
                kerdoiv_emlekezteto_tiltva_at AS changed_at,
                kerdoiv_emlekezteto_tiltva_by AS changed_by`,
    [patientId, optedOut, changedBy],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    optedOut: row.opted_out === true,
    changedAt: row.changed_at ? new Date(row.changed_at).toISOString() : null,
    changedBy: row.changed_by ?? null,
  };
}

/** Body → boolean validálás (route-ok közös). */
export function parseOptOutBody(body: unknown): boolean | null {
  const v = (body as { optedOut?: unknown } | null)?.optedOut;
  return typeof v === 'boolean' ? v : null;
}

/**
 * Leiratkozáskor azonnal lezárjuk a beteg nyitott kérdőív-feladatait (OHIP +
 * önkitöltés) és az OHIP-eszkalációt, hogy a portálon és az orvosnál se
 * maradjon ott a nudge a következő cron-futásig. Best-effort.
 */
export async function closeQuestionnaireTasksOnOptOut(patientId: string): Promise<void> {
  const [{ closeOpenOhipPatientTasks, closeOpenOhipEscalationTasks }, { closeOpenSelfFillTasks }] =
    await Promise.all([
      import('@/lib/ohip14-patient-tasks'),
      import('@/lib/patient-selffill-reminders'),
    ]);
  await Promise.all([
    closeOpenOhipPatientTasks(patientId),
    closeOpenOhipEscalationTasks(patientId),
    closeOpenSelfFillTasks(patientId),
  ]);
}
