import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import {
  getPatientConsentState,
  grantResearchConsent,
  withdrawResearchConsent,
  markConsentPending,
  listPatientConsentEvents,
} from '@/lib/tmk/research-consent-service';

export const dynamic = 'force-dynamic';

const grantSchema = z.object({
  action: z.literal('grant'),
  captureMethod: z.enum(['written_form', 'verbal_documented', 'electronic']),
  attestation: z.literal('patient_informed_and_agreed'),
  reason: z.string().max(2000).optional(),
  consentVersionId: z.string().uuid().optional(),
});

const withdrawSchema = z.object({
  action: z.literal('withdraw'),
  reason: z.string().min(3).max(2000),
  captureMethod: z
    .enum(['written_form', 'verbal_documented', 'patient_portal', 'electronic'])
    .optional(),
});

const pendingSchema = z.object({
  action: z.literal('pending'),
  reason: z.string().max(2000).optional(),
});

const bodySchema = z.discriminatedUnion('action', [
  grantSchema,
  withdrawSchema,
  pendingSchema,
]);

const STAFF_ROLES = ['admin', 'fogpótlástanász', 'beutalo_orvos'] as const;

export const GET = authedHandler(async (_req, { params }) => {
  const patientId = params.id;
  const state = await getPatientConsentState(patientId);
  if (!state) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }
  const events = await listPatientConsentEvents(patientId);
  return NextResponse.json({ state, events });
});

export const POST = authedHandler(async (req, { params, auth }) => {
  if (!STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number])) {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
  }

  const patientId = params.id;
  const body = bodySchema.parse(await req.json());

  const actor = { id: auth.userId, email: auth.email };

  if (body.action === 'grant') {
    const state = await grantResearchConsent(patientId, {
      captureMethod: body.captureMethod,
      attestation: body.attestation,
      reason: body.reason,
      consentVersionId: body.consentVersionId,
      actor,
    });
    return NextResponse.json({ state });
  }

  if (body.action === 'withdraw') {
    const state = await withdrawResearchConsent(patientId, {
      actor,
      reason: body.reason,
      captureMethod: body.captureMethod ?? 'verbal_documented',
    });
    return NextResponse.json({ state });
  }

  const state = await markConsentPending(patientId, actor, body.reason);
  return NextResponse.json({ state });
});
