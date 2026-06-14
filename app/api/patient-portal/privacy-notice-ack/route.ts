import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { getPatientConsentObligations } from '@/lib/consent-obligations';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@/lib/legal/policy-version';
import { requiresGuardian } from '@/lib/legal/legal-capacity';
import { writeAuditEvent } from '@/lib/research-registry/audit-events';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Patient-initiated acknowledgement of the privacy notice (adatvédelmi
 * tájékoztató). This is the Art. 13 information duty — NOT consent. Records
 * which policy version was acknowledged, with IP/user-agent for demonstrability.
 * For minors, the declaration is made by the stored legal guardian.
 */
export const POST = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const pool = getDbPool();
  const patientRes = await pool.query(
    `SELECT szuletesi_datum, torvenyes_kepviselo_nev, torvenyes_kepviselo_kapcsolat
     FROM patients WHERE id = $1`,
    [patientId]
  );
  if (patientRes.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }
  const patient = patientRes.rows[0];

  const ipHeader = req.headers.get('x-forwarded-for') || '';
  const ipAddress = ipHeader.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('user-agent') || null;

  const minor = requiresGuardian(patient.szuletesi_datum);
  if (minor && !patient.torvenyes_kepviselo_nev) {
    return NextResponse.json(
      { error: 'Kiskorú páciensnél törvényes képviselő szükséges. Kérjük, vegye fel a kapcsolatot az adminisztrációval.' },
      { status: 409 }
    );
  }
  const onBehalf = minor
    ? {
        onBehalfOfMinor: true,
        guardianName: patient.torvenyes_kepviselo_nev as string,
        guardianRelation: (patient.torvenyes_kepviselo_kapcsolat as string) ?? null,
      }
    : {};

  await pool.query(
    `INSERT INTO privacy_notice_acknowledgements
       (patient_id, policy_version, ip_address, user_agent, on_behalf)
     VALUES ($1, $2, $3::inet, $4, $5::jsonb)`,
    [patientId, CURRENT_PRIVACY_POLICY_VERSION, ipAddress, userAgent, JSON.stringify(onBehalf)]
  );

  await writeAuditEvent(pool, {
    entityType: 'patient',
    entityId: patientId,
    action: 'privacy_notice_acknowledged',
    actorId: `patient:${patientId}`,
    newState: { policyVersion: CURRENT_PRIVACY_POLICY_VERSION, onBehalf },
  }).catch((e) => logger.error('Failed to write privacy-notice-ack audit event:', e));

  logger.info(`Privacy notice acknowledged: patient=${patientId} version=${CURRENT_PRIVACY_POLICY_VERSION}`);

  const obligations = await getPatientConsentObligations(patientId);
  return NextResponse.json({ success: true, obligations });
});
