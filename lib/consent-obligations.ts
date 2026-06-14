/**
 * Patient consent obligations: combines the privacy-notice acknowledgement
 * (Art. 13 information duty — NOT consent) and the research consent
 * (patients.consent_status, genuine Art. 9(2)(a) consent) into a single
 * "what does this patient still owe" view, used by the portal banner, the
 * registration trigger and the daily reminder cron.
 *
 * Rules (see plan):
 *  - Notice acknowledged = a privacy_notice_acknowledgements row exists for the
 *    CURRENT policy version. (A version bump re-prompts everyone.)
 *  - Research decided = consent_status NOT IN ('unknown','pending').
 *    ('granted' | 'declined' | 'withdrawn' | 'expired' all count as decided.)
 *  - Reminders fire while (notice not acknowledged) OR (research not decided).
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@/lib/legal/policy-version';

type Db = Pool | PoolClient;

export interface ConsentObligations {
  noticeAcknowledged: boolean;
  researchDecided: boolean;
  researchStatus: string;
  needsNoticeAck: boolean;
  needsResearch: boolean;
  needsAction: boolean;
}

/**
 * SQL fragment that is TRUE when the patient has acknowledged the CURRENT
 * privacy notice version. `$<versionParam>` must bind CURRENT_PRIVACY_POLICY_VERSION.
 */
export function noticeAcknowledgedSql(patientAlias = 'p', versionParam = '$1'): string {
  return `EXISTS (
    SELECT 1 FROM privacy_notice_acknowledgements pna
    WHERE pna.patient_id = ${patientAlias}.id
      AND pna.policy_version = ${versionParam}
  )`;
}

const DECIDED_RESEARCH_STATUSES = new Set([
  'granted',
  'declined',
  'withdrawn',
  'expired',
]);

/** Pure predicate: given research status and the notice-ack flag, what is still owed. */
export function computeObligations(researchStatus: string, noticeAcknowledged: boolean): ConsentObligations {
  const researchDecided = DECIDED_RESEARCH_STATUSES.has(researchStatus);
  const needsNoticeAck = !noticeAcknowledged;
  const needsResearch = !researchDecided;
  return {
    noticeAcknowledged,
    researchDecided,
    researchStatus,
    needsNoticeAck,
    needsResearch,
    needsAction: needsNoticeAck || needsResearch,
  };
}

export async function getPatientConsentObligations(
  patientId: string,
  pool?: Db
): Promise<ConsentObligations | null> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT COALESCE(p.consent_status, 'unknown') AS research_status,
            ${noticeAcknowledgedSql('p', '$2')} AS notice_acknowledged
     FROM patients p
     WHERE p.id = $1`,
    [patientId, CURRENT_PRIVACY_POLICY_VERSION]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return computeObligations(row.research_status as string, row.notice_acknowledged === true);
}
