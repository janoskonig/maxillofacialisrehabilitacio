import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { isValidUUID } from '@/lib/validation';
import { baselineAmendmentSchema, deliverySchema, encounterSchema, followupSchema, prosthesisSchema } from '@/lib/aftercare/model';
import { amendBaseline, deliverProsthesis, loadAftercareWorkspace, recordCareEncounter, recordFollowup, registerProsthesis } from '@/lib/aftercare/service';

export const dynamic = 'force-dynamic';
const roles = ['admin', 'fogpótlástanász', 'beutalo_orvos'] as const;
function patientId(id: string) {
  if (!isValidUUID(id)) throw new HttpError(400, 'Érvénytelen betegazonosító');
  return id;
}
export const GET = roleHandler([...roles], async (_req, { params }) => {
  return NextResponse.json(await loadAftercareWorkspace(patientId(params.id)), { headers: { 'Cache-Control': 'no-store' } });
});
export const POST = roleHandler([...roles], async (req, { params, auth }) => {
  const id = patientId(params.id);
  const body = await req.json().catch(() => null);
  const action = body?.action;
  const schema = action === 'register' ? prosthesisSchema : action === 'deliver' ? deliverySchema
    : action === 'record_visit' ? encounterSchema : action === 'followup' ? followupSchema : action === 'amend_baseline' ? baselineAmendmentSchema : null;
  if (!schema) throw new HttpError(400, 'Ismeretlen művelet');
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
  const input = parsed.data;
  let result;
  switch (input.action) {
    case 'register': result = await registerProsthesis(id, auth.userId, input); break;
    case 'deliver': result = await deliverProsthesis(id, auth.userId, input); break;
    case 'record_visit': result = await recordCareEncounter(id, auth.userId, input); break;
    case 'followup': result = await recordFollowup(id, auth.userId, input); break;
    case 'amend_baseline': result = await amendBaseline(id, auth.userId, input); break;
  }
  return NextResponse.json(result, { status: 201 });
});
