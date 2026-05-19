import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import {
  getPatientConsentState,
  grantResearchConsent,
  withdrawResearchConsent,
  listPatientConsentEvents,
} from '@/lib/tmk/research-consent-service';

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

  if (body.action === 'grant') {
    const state = await grantResearchConsent(patientId, {
      captureMethod: 'patient_portal',
      attestation: body.attestation,
      actor: { email: `patient:${patientId}` },
    });
    return NextResponse.json({ state });
  }

  const state = await withdrawResearchConsent(patientId, {
    actor: { email: `patient:${patientId}` },
    reason: body.reason,
    captureMethod: 'patient_portal',
  });
  return NextResponse.json({ state });
});
