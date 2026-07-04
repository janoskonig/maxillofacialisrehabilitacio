import { getDbPool } from '@/lib/db';
import { insertUserTask } from '@/lib/user-tasks';
import { sendEmail } from '@/lib/email';
import { queueAdminNotification } from '@/lib/email/admin-notification-queue';
import { logger } from '@/lib/logger';

/**
 * Consent-konfliktus eszkaláció a klinikavezetéshez.
 *
 * Az "önjáró" consent-modellben a nyilatkoztatást a rendszer intézi (heti
 * nudge a portálon), az admin CSAK a konfliktussal találkozik: a kutatási
 * hozzájárulás megtagadásával (declined) vagy visszavonásával (withdrawn).
 * Ilyenkor nyitott admin-feladat + azonnali e-mail készül — a döntés jogi/
 * kutatási következményeit (export-kizárás, esetleges megkeresés) ember
 * mérlegeli.
 */

export type ConsentConflictType = 'declined' | 'withdrawn';

/** Címhez (szenvedő szerkezet): "Kutatási hozzájárulás megtagadva". */
const CONFLICT_LABEL_PASSIVE: Record<ConsentConflictType, string> = {
  declined: 'megtagadva',
  withdrawn: 'visszavonva',
};

/** Mondathoz (cselekvő): "A beteg megtagadta ...". */
const CONFLICT_LABEL_ACTIVE: Record<ConsentConflictType, string> = {
  declined: 'megtagadta',
  withdrawn: 'visszavonta',
};

export async function escalateConsentConflict(
  patientId: string,
  type: ConsentConflictType,
  reason?: string | null
): Promise<void> {
  const pool = getDbPool();

  const patientRes = await pool.query(`SELECT nev FROM patients WHERE id = $1`, [patientId]);
  const patientName: string = patientRes.rows[0]?.nev ?? 'Név nélküli beteg';

  const admins = await pool.query(
    `SELECT id, email, doktor_neve FROM users
      WHERE role = 'admin' AND active IS NOT FALSE
        AND email IS NOT NULL AND btrim(email) <> ''`
  );
  if (admins.rows.length === 0) return;

  const title = `Kutatási hozzájárulás ${CONFLICT_LABEL_PASSIVE[type]} – ${patientName}`;
  const description = reason?.trim()
    ? `A beteg ${CONFLICT_LABEL_ACTIVE[type]} a kutatási hozzájárulását. Indok: ${reason.trim()}`
    : `A beteg ${CONFLICT_LABEL_ACTIVE[type]} a kutatási hozzájárulását.`;

  // Nyitott admin-feladat (idempotens: betegenként + típusonként + adminonként egy).
  for (const admin of admins.rows) {
    const existing = await pool.query(
      `SELECT 1 FROM user_tasks
        WHERE task_type = 'manual'
          AND status = 'open'
          AND patient_id = $1
          AND assignee_user_id = $2
          AND metadata->>'source' = 'consent_conflict'
          AND metadata->>'conflictType' = $3
        LIMIT 1`,
      [patientId, admin.id, type]
    );
    if (existing.rows.length > 0) continue;

    await insertUserTask({
      assigneeKind: 'staff',
      assigneeUserId: admin.id,
      assigneePatientId: null,
      patientId,
      taskType: 'manual',
      title,
      description,
      metadata: { source: 'consent_conflict', conflictType: type },
      createdByUserId: admin.id,
    });
  }

  // Azonnali e-mail az adminoknak (a konfliktus ritka és fontos). Ha az
  // e-mail elbukik, a feladat és a digest-értesítés akkor is megmarad.
  try {
    await sendEmail({
      to: admins.rows.map((a: any) => a.email as string),
      subject: title,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2 style="color: #b91c1c;">${title}</h2>
          <p>${description}</p>
          <p>A beteg adatai a jövőben nem használhatók kutatási célra
          (a korábban fagyasztott exportok érintetlenek — exclude_future_only szabály).</p>
          <p>A teendő megjelent a Feladataim listában is.</p>
        </div>
      `,
      emailType: 'consent_conflict',
      metadata: { patientId, conflictType: type },
    });
  } catch (err) {
    logger.error(`[consent-conflict] e-mail hiba (${patientId}, ${type}):`, err);
  }

  await queueAdminNotification(
    'research_consent_conflict',
    `${patientName} — kutatási hozzájárulás ${CONFLICT_LABEL_PASSIVE[type]}`,
    { patientId, conflictType: type, reason: reason ?? null }
  ).catch(() => {});
}

/** Fire-and-forget burkoló — a consent-írási folyamot sosem töri meg. */
export function escalateConsentConflictSilent(
  patientId: string,
  type: ConsentConflictType,
  reason?: string | null
): void {
  escalateConsentConflict(patientId, type, reason).catch((err) => {
    logger.error(`[consent-conflict] eszkaláció hiba (${patientId}, ${type}):`, err);
  });
}
