import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import { requiresGuardian } from '@/lib/legal/legal-capacity';
import {
  getPatientConsentState,
  grantResearchConsent,
  withdrawResearchConsent,
  declineResearchConsent,
  listPatientConsentEvents,
  type ConsentRequestContext,
} from '@/lib/research-registry/research-consent-service';

async function buildConsentContext(req: Request, patientId: string): Promise<ConsentRequestContext> {
  const ipHeader = req.headers.get('x-forwarded-for') || '';
  const ipAddress = ipHeader.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('user-agent') || null;

  const res = await getDbPool().query(
    `SELECT szuletesi_datum, torvenyes_kepviselo_nev, torvenyes_kepviselo_kapcsolat
     FROM patients WHERE id = $1`,
    [patientId]
  );
  const p = res.rows[0];
  const minor = p ? requiresGuardian(p.szuletesi_datum) : false;
  return {
    ipAddress,
    userAgent,
    onBehalf: minor
      ? {
          onBehalfOfMinor: true,
          guardianName: (p.torvenyes_kepviselo_nev as string) ?? null,
          guardianRelation: (p.torvenyes_kepviselo_kapcsolat as string) ?? null,
        }
      : null,
  };
}

export const dynamic = 'force-dynamic';

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant'),
    attestation: z.literal('i_agree_to_research_consent'),
  }),
  z.object({
    action: z.literal('withdraw'),
    reason: z.string().min(3).max(2000),
  }),
  z.object({
    action: z.literal('decline'),
    reason: z.string().min(3).max(2000).optional(),
  }),
]);

export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const state = await getPatientConsentState(patientId);
  const events = await listPatientConsentEvents(patientId, 10);
  return NextResponse.json({ state, events });
});

export const POST = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const body = postSchema.parse(await req.json());
  const context = await buildConsentContext(req, patientId);

  if (body.action === 'grant') {
    const state = await grantResearchConsent(patientId, {
      captureMethod: 'patient_portal',
      attestation: body.attestation,
      actor: { email: `patient:${patientId}` },
      context,
    });
    return NextResponse.json({ state });
  }

  if (body.action === 'decline') {
    const state = await declineResearchConsent(patientId, {
      actor: { email: `patient:${patientId}` },
      reason: body.reason,
      captureMethod: 'patient_portal',
      context,
    });
    return NextResponse.json({ state });
  }

  const state = await withdrawResearchConsent(patientId, {
    actor: { email: `patient:${patientId}` },
    reason: body.reason,
    captureMethod: 'patient_portal',
    context,
  });
  return NextResponse.json({ state });
});
