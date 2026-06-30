/**
 * Research registry consent lifecycle (grant / withdraw / history).
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { writeAuditEvent } from './audit-events';
import type { ConsentStatus } from './consent';

type Db = Pool | PoolClient;

export type ConsentCaptureMethod =
  | 'written_form'
  | 'verbal_documented'
  | 'patient_portal'
  | 'electronic';

export interface ActiveConsentVersion {
  id: string;
  versionLabel: string;
  consentBodyHu: string | null;
  effectiveFrom: string;
  protocolCode: string;
  protocolTitle: string;
}

export interface PatientConsentState {
  patientId: string;
  consentStatus: ConsentStatus;
  consentVersionId: string | null;
  consentGrantedAt: string | null;
  consentWithdrawnAt: string | null;
  researchUsableUntil: string | null;
  legacyComplianceStatus: string | null;
  researchUsable: boolean;
  activeVersion: ActiveConsentVersion | null;
}

export interface ConsentEventRow {
  id: string;
  eventType: string;
  previousStatus: string | null;
  newStatus: string;
  captureMethod: string | null;
  actorEmail: string | null;
  reason: string | null;
  recordedAt: string;
  versionLabel: string | null;
}

export interface ConsentRequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Guardian declaring on behalf of a minor, recorded for demonstrability. */
  onBehalf?: { onBehalfOfMinor: boolean; guardianName?: string | null; guardianRelation?: string | null } | null;
}

async function insertConsentEvent(
  db: Db,
  input: {
    patientId: string;
    eventType: string;
    consentVersionId: string | null;
    previousStatus: string | null;
    newStatus: string;
    captureMethod?: ConsentCaptureMethod | null;
    actorId?: string | null;
    actorEmail?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO patient_consent_events (
       patient_id, event_type, consent_version_id, previous_status, new_status,
       capture_method, actor_id, actor_email, reason, metadata, ip_address, user_agent
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::inet, $12)`,
    [
      input.patientId,
      input.eventType,
      input.consentVersionId,
      input.previousStatus,
      input.newStatus,
      input.captureMethod ?? null,
      input.actorId ?? null,
      input.actorEmail ?? null,
      input.reason ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ]
  );
}

export async function getActiveConsentVersion(pool?: Db): Promise<ActiveConsentVersion | null> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT cv.id, cv.version_label AS "versionLabel",
            cv.consent_body_hu AS "consentBodyHu",
            cv.effective_from::text AS "effectiveFrom",
            p.protocol_code AS "protocolCode",
            p.title AS "protocolTitle"
     FROM consent_versions cv
     JOIN registry_protocols p ON p.id = cv.protocol_id
     WHERE cv.is_active = true
     ORDER BY cv.effective_from DESC
     LIMIT 1`
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id as string,
    versionLabel: row.versionLabel as string,
    consentBodyHu: (row.consentBodyHu as string) ?? null,
    effectiveFrom: row.effectiveFrom as string,
    protocolCode: row.protocolCode as string,
    protocolTitle: row.protocolTitle as string,
  };
}

export async function getPatientConsentState(
  patientId: string,
  pool?: Db
): Promise<PatientConsentState | null> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT id,
            consent_status AS "consentStatus",
            consent_version_id AS "consentVersionId",
            consent_granted_at AS "consentGrantedAt",
            consent_withdrawn_at AS "consentWithdrawnAt",
            research_usable_until AS "researchUsableUntil",
            legacy_compliance_status AS "legacyComplianceStatus"
     FROM patients WHERE id = $1`,
    [patientId]
  );
  if (r.rows.length === 0) return null;

  const row = r.rows[0];
  const activeVersion = await getActiveConsentVersion(db);
  const { isPatientResearchUsable } = await import('./consent');

  return {
    patientId,
    consentStatus: (row.consentStatus as ConsentStatus) ?? 'unknown',
    consentVersionId: (row.consentVersionId as string) ?? null,
    consentGrantedAt: row.consentGrantedAt
      ? new Date(row.consentGrantedAt as string).toISOString()
      : null,
    consentWithdrawnAt: row.consentWithdrawnAt
      ? new Date(row.consentWithdrawnAt as string).toISOString()
      : null,
    researchUsableUntil: row.researchUsableUntil
      ? new Date(row.researchUsableUntil as string).toISOString()
      : null,
    legacyComplianceStatus: (row.legacyComplianceStatus as string) ?? null,
    researchUsable: await isPatientResearchUsable(patientId, db as Pool),
    activeVersion,
  };
}

export async function listPatientConsentEvents(
  patientId: string,
  limit = 20,
  pool?: Db
): Promise<ConsentEventRow[]> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT e.id, e.event_type AS "eventType",
            e.previous_status AS "previousStatus",
            e.new_status AS "newStatus",
            e.capture_method AS "captureMethod",
            e.actor_email AS "actorEmail",
            e.reason,
            e.recorded_at AS "recordedAt",
            cv.version_label AS "versionLabel"
     FROM patient_consent_events e
     LEFT JOIN consent_versions cv ON cv.id = e.consent_version_id
     WHERE e.patient_id = $1
     ORDER BY e.recorded_at DESC
     LIMIT $2`,
    [patientId, limit]
  );
  return r.rows.map((row) => ({
    id: row.id as string,
    eventType: row.eventType as string,
    previousStatus: (row.previousStatus as string) ?? null,
    newStatus: row.newStatus as string,
    captureMethod: (row.captureMethod as string) ?? null,
    actorEmail: (row.actorEmail as string) ?? null,
    reason: (row.reason as string) ?? null,
    recordedAt: new Date(row.recordedAt as string).toISOString(),
    versionLabel: (row.versionLabel as string) ?? null,
  }));
}

export async function markConsentPending(
  patientId: string,
  actor: { id?: string; email?: string },
  reason?: string,
  pool?: Db
): Promise<PatientConsentState> {
  const db = pool ?? getDbPool();
  const current = await getPatientConsentState(patientId, db);
  if (!current) throw new Error('Patient not found');

  const version = await getActiveConsentVersion(db);
  await db.query(
    // set_config(...): a hozzájárulás szerver/portál-kezelt mellék-írás → őrizze
    // meg a beteg optimista zár tokenjét (updated_at), ne 409-eltessen egy
    // nyitva tartott staff-űrlapot. Lásd database/migrations/062.
    `UPDATE patients SET consent_status = 'pending'
      WHERE id = $1 AND set_config('app.skip_updated_at','on',true) IS NOT NULL`,
    [patientId]
  );

  await insertConsentEvent(db, {
    patientId,
    eventType: 'pending',
    consentVersionId: version?.id ?? null,
    previousStatus: current.consentStatus,
    newStatus: 'pending',
    actorId: actor.id,
    actorEmail: actor.email,
    reason,
  });

  await writeAuditEvent(db, {
    entityType: 'patient',
    entityId: patientId,
    action: 'research_consent_pending',
    actorId: actor.id,
    actorEmail: actor.email,
    reason,
    oldState: { consentStatus: current.consentStatus },
    newState: { consentStatus: 'pending' },
  });

  return (await getPatientConsentState(patientId, db))!;
}

export async function grantResearchConsent(
  patientId: string,
  input: {
    captureMethod: ConsentCaptureMethod;
    actor: { id?: string; email?: string };
    reason?: string;
    consentVersionId?: string;
    attestation?: string;
    context?: ConsentRequestContext;
  },
  pool?: Db
): Promise<PatientConsentState> {
  const db = pool ?? getDbPool();
  const current = await getPatientConsentState(patientId, db);
  if (!current) throw new Error('Patient not found');
  if (current.consentStatus === 'granted') {
    return current;
  }

  const version =
    input.consentVersionId != null
      ? (
          await db.query(
            `SELECT cv.id, cv.version_label AS "versionLabel",
                    cv.consent_body_hu AS "consentBodyHu",
                    cv.effective_from::text AS "effectiveFrom",
                    p.protocol_code AS "protocolCode",
                    p.title AS "protocolTitle"
             FROM consent_versions cv
             JOIN registry_protocols p ON p.id = cv.protocol_id
             WHERE cv.id = $1`,
            [input.consentVersionId]
          )
        ).rows[0]
      : null;

  const active = version
    ? {
        id: version.id as string,
        versionLabel: version.versionLabel as string,
        consentBodyHu: (version.consentBodyHu as string) ?? null,
        effectiveFrom: version.effectiveFrom as string,
        protocolCode: version.protocolCode as string,
        protocolTitle: version.protocolTitle as string,
      }
    : await getActiveConsentVersion(db);

  if (!active) {
    throw new Error('No active consent version configured');
  }

  if (
    input.attestation !== 'patient_informed_and_agreed' &&
    input.captureMethod !== 'patient_portal'
  ) {
    throw new Error('Staff grant requires attestation patient_informed_and_agreed');
  }

  await db.query(
    `UPDATE patients SET
       consent_status = 'granted',
       consent_version_id = $2,
       consent_granted_at = CURRENT_TIMESTAMP,
       consent_withdrawn_at = NULL,
       legacy_compliance_status = 'VERIFIED'
     WHERE id = $1 AND set_config('app.skip_updated_at','on',true) IS NOT NULL`,
    [patientId, active.id]
  );

  await db.query(
    `UPDATE entity_quality_state
     SET quality_state = CASE
           WHEN quality_state IN ('LEGACY_UNVERIFIED', 'IMPORTED_LEGACY') THEN 'DRAFT'
           ELSE quality_state
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE entity_type = 'patient' AND entity_id = $1`,
    [patientId]
  );

  await insertConsentEvent(db, {
    patientId,
    eventType: 'granted',
    consentVersionId: active.id,
    previousStatus: current.consentStatus,
    newStatus: 'granted',
    captureMethod: input.captureMethod,
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    reason: input.reason,
    metadata: { attestation: input.attestation ?? null, onBehalf: input.context?.onBehalf ?? null },
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
  });

  await writeAuditEvent(db, {
    entityType: 'patient',
    entityId: patientId,
    action: 'research_consent_granted',
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    reason: input.reason,
    oldState: { consentStatus: current.consentStatus },
    newState: {
      consentStatus: 'granted',
      consentVersionId: active.id,
      legacyComplianceStatus: 'VERIFIED',
    },
  });

  return (await getPatientConsentState(patientId, db))!;
}

export async function declineResearchConsent(
  patientId: string,
  input: {
    actor: { id?: string; email?: string };
    reason?: string;
    captureMethod?: ConsentCaptureMethod;
    context?: ConsentRequestContext;
  },
  pool?: Db
): Promise<PatientConsentState> {
  const db = pool ?? getDbPool();
  const current = await getPatientConsentState(patientId, db);
  if (!current) throw new Error('Patient not found');
  if (current.consentStatus === 'declined') {
    return current;
  }

  const version = await getActiveConsentVersion(db);
  await db.query(
    `UPDATE patients SET consent_status = 'declined'
      WHERE id = $1 AND set_config('app.skip_updated_at','on',true) IS NOT NULL`,
    [patientId]
  );

  await insertConsentEvent(db, {
    patientId,
    eventType: 'declined',
    consentVersionId: version?.id ?? null,
    previousStatus: current.consentStatus,
    newStatus: 'declined',
    captureMethod: input.captureMethod ?? 'patient_portal',
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    reason: input.reason,
    metadata: { onBehalf: input.context?.onBehalf ?? null },
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
  });

  await writeAuditEvent(db, {
    entityType: 'patient',
    entityId: patientId,
    action: 'research_consent_declined',
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    reason: input.reason,
    oldState: { consentStatus: current.consentStatus },
    newState: { consentStatus: 'declined' },
  });

  return (await getPatientConsentState(patientId, db))!;
}

export async function withdrawResearchConsent(
  patientId: string,
  input: {
    actor: { id?: string; email?: string };
    reason?: string;
    captureMethod?: ConsentCaptureMethod;
    context?: ConsentRequestContext;
  },
  pool?: Db
): Promise<PatientConsentState> {
  const db = pool ?? getDbPool();
  const { recordConsentWithdrawal } = await import('./consent');
  const current = await getPatientConsentState(patientId, db);
  if (!current) throw new Error('Patient not found');

  await recordConsentWithdrawal(patientId, db as Pool);

  await insertConsentEvent(db, {
    patientId,
    eventType: 'withdrawn',
    consentVersionId: current.consentVersionId,
    previousStatus: current.consentStatus,
    newStatus: 'withdrawn',
    captureMethod: input.captureMethod ?? 'patient_portal',
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    reason: input.reason,
    metadata: { onBehalf: input.context?.onBehalf ?? null },
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
  });

  await writeAuditEvent(db, {
    entityType: 'patient',
    entityId: patientId,
    action: 'research_consent_withdrawn',
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    reason: input.reason,
    oldState: { consentStatus: current.consentStatus },
    newState: { consentStatus: 'withdrawn' },
  });

  return (await getPatientConsentState(patientId, db))!;
}

export async function listPendingConsentPatients(
  centerCode: string | null,
  limit = 50,
  pool?: Db
): Promise<
  Array<{
    patientId: string;
    nev: string | null;
    consentStatus: string;
    legacyComplianceStatus: string | null;
    felvetelDatuma: string | null;
  }>
> {
  const db = pool ?? getDbPool();
  const params: unknown[] = [];
  let centerFilter = '';
  if (centerCode) {
    params.push(centerCode);
    centerFilter = `AND u.intezmeny = $${params.length}`;
  }
  params.push(limit);

  const r = await db.query(
    `SELECT DISTINCT ON (p.id)
            p.id AS "patientId",
            p.nev,
            p.consent_status AS "consentStatus",
            p.legacy_compliance_status AS "legacyComplianceStatus",
            p.felvetel_datuma::text AS "felvetelDatuma"
     FROM patients p
     LEFT JOIN users u ON u.id = p.kezeleoorvos_user_id
     WHERE COALESCE(p.consent_status, 'unknown') IN ('unknown', 'pending')
     ${centerFilter}
     ORDER BY p.id, p.felvetel_datuma DESC NULLS LAST
     LIMIT $${params.length}`,
    params
  );

  return r.rows as Array<{
    patientId: string;
    nev: string | null;
    consentStatus: string;
    legacyComplianceStatus: string | null;
    felvetelDatuma: string | null;
  }>;
}
