/**
 * EüAK (1997. évi XLVII. tv.) betekintési napló.
 *
 * Naplózza, hogy a személyzet mikor OLVASSA egy konkrét beteg egészségügyi
 * adatait. A törvény a hozzáférés (betekintés) nyomon követhetőségét várja el.
 * Írásokat itt NEM naplózunk — azokat a patient_changes / audit_events fedi.
 *
 * A naplózás fire-and-forget: sosem await-elt és sosem dob, így a válaszidőt
 * nem befolyásolja. A hívási pont a route-handler wrapRoute()-ja, amely minden
 * /api/patients/[id]/** kérésen áthalad.
 */
import type { NextRequest } from 'next/server';
import { getDbPool } from '../db';
import { logger } from '../logger';
import type { AuthPayload } from '../auth-server';

/**
 * Egy beteg-rekord olvasó útvonalát ismeri fel: GET /api/patients/<UUID>[/...].
 * Az UUID-követelmény automatikusan kizárja a lista- és segédvégpontokat
 * (/api/patients, /api/patients/duplicate-check, /api/patients/recognize stb.),
 * a /api/patient-portal/** pedig eleve nem illik a mintára (a beteg saját
 * adatának olvasása nem személyzeti betekintés).
 */
const PATIENT_DETAIL_PATH_RE =
  /^\/api\/patients\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export type PatientAccess = { patientId: string; route: string };

/**
 * Pure: visszaadja a beteg-azonosítót és a normalizált útvonalat, ha az adott
 * (pathname, method) egy beteg-rekord olvasása; egyébként null.
 */
export function extractPatientAccess(pathname: string, method: string): PatientAccess | null {
  if (method.toUpperCase() !== 'GET') return null;
  const m = PATIENT_DETAIL_PATH_RE.exec(pathname);
  if (!m) return null;
  const patientId = m[1].toLowerCase();
  // Az UUID-t :id-re normalizáljuk, hogy a route oszlop alacsony kardinalitású maradjon.
  const route = pathname.replace(m[1], ':id');
  return { patientId, route };
}

function clientIp(req: NextRequest): string | null {
  const ipHeader = req.headers.get('x-forwarded-for') || '';
  return ipHeader.split(',')[0]?.trim() || null;
}

type LogInput = {
  patientId: string;
  route: string;
  method: string;
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string | null;
  correlationId: string | null;
  ipAddress: string | null;
};

/**
 * Fire-and-forget INSERT. Nem await-elt, nem dob — hiba esetén csak logol.
 */
export function logPatientDataAccessFireAndForget(input: LogInput): void {
  void getDbPool()
    .query(
      `INSERT INTO patient_data_access_log
         (patient_id, actor_user_id, actor_email, actor_role, route, method, correlation_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.patientId,
        input.actorUserId,
        input.actorEmail,
        input.actorRole,
        input.route,
        input.method,
        input.correlationId,
        input.ipAddress,
      ],
    )
    .catch((err) => {
      logger.error('patient_data_access_log insert failed', {
        patientId: input.patientId,
        route: input.route,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * A route-handler wrapRoute()-jából hívott belépési pont: kiszűri a beteg-rekord
 * olvasásokat és fire-and-forget naplózza. Nem dob, hogy sose befolyásolja a kérést.
 */
export function maybeLogPatientAccess(
  req: NextRequest,
  auth: AuthPayload,
  correlationId: string,
): void {
  try {
    const access = extractPatientAccess(req.nextUrl.pathname, req.method);
    if (!access) return;
    logPatientDataAccessFireAndForget({
      patientId: access.patientId,
      route: access.route,
      method: req.method.toUpperCase(),
      actorUserId: auth.userId ?? null,
      actorEmail: auth.email,
      actorRole: auth.role ?? null,
      correlationId,
      ipAddress: clientIp(req),
    });
  } catch (err) {
    logger.error('maybeLogPatientAccess failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
