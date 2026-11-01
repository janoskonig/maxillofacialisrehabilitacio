import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { probeColumnExists } from '@/lib/schema-probe';
import { isValidUUID } from '@/lib/validation';
import { logActivity } from '@/lib/activity';
import { parseEpisodeTreatmentPlanUpdate } from '@/lib/episode-treatment-plan';
import { randomUUID } from 'crypto';
import { budapestToday } from '@/lib/aftercare/model';
import { clinicalCommandSchema } from '@/lib/prosthesis-lifecycle/model';
import { executeClinicalCommand } from '@/lib/prosthesis-lifecycle/service';
import { loadEpisodeTreatmentPlan, TreatmentPlanConflict } from '@/lib/prosthesis-lifecycle/plans';

export const dynamic = 'force-dynamic';

async function checkSchema() {
  const pool = getDbPool();
  const available = await Promise.all([
    probeColumnExists(pool, 'patient_episodes', 'treatment_plan'),
    probeColumnExists(pool, 'patient_episodes', 'treatment_plan_version'),
    probeColumnExists(pool, 'patient_episodes', 'treatment_plan_upper'),
    probeColumnExists(pool, 'patient_episodes', 'treatment_plan_lower'),
    probeColumnExists(pool, 'prosthesis_plan_versions', 'episode_plan_version'),
    probeColumnExists(pool, 'episode_financing_events', 'effective_on'),
  ]);
  return available.every(Boolean);
}

function unavailable() {
  return NextResponse.json({ error: 'A kezelési terv mező még nem érhető el. Az adatbázis frissítése szükséges.', code: 'TREATMENT_PLAN_SCHEMA_UNAVAILABLE' }, { status: 503 });
}

export const GET = authedHandler(async (_req, { params }) => {
  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Érvénytelen epizódazonosító.' }, { status: 400 });
  if (!await checkSchema()) return unavailable();
  const plan = await loadEpisodeTreatmentPlan(getDbPool(), params.id, true);
  if (!plan) return NextResponse.json({ error: 'Epizód nem található.' }, { status: 404 });
  return NextResponse.json({ plan }, { headers: { 'Cache-Control': 'private, no-store' } });
});

// Saving a clinical description never regenerates steps, bookings or scheduling intents.
export const PATCH = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Érvénytelen epizódazonosító.' }, { status: 400 });
  const update = parseEpisodeTreatmentPlanUpdate(await req.json());
  if ('error' in update) return NextResponse.json({ error: update.error }, { status: 400 });
  if (!await checkSchema()) return unavailable();
  const pool = getDbPool();
  const current=await loadEpisodeTreatmentPlan(pool,params.id);
  if(!current)return NextResponse.json({error:'Epizód nem található.'},{status:404});
  const clinical=update.clinical;
  const command=clinicalCommandSchema.parse({action:'plan',episodeId:params.id,
    requestKey:clinical?.requestKey??randomUUID(),occurredOn:clinical?.occurredOn??budapestToday(),
    source:clinical?.source??'Kezelés fül – kezelési terv',approved:clinical?.approved??false,
    expectedVersion:update.expectedVersion,
    ...(clinical?{baselineStateId:clinical.baselineStateId,treatments:clinical.treatments}:{}),
    narratives:update.mode==='jaws'?{treatmentPlanUpper:update.treatmentPlanUpper,treatmentPlanLower:update.treatmentPlanLower}:{treatmentPlan:update.treatmentPlan},
  });
  try {
    await executeClinicalCommand(current.patientId!,auth.userId,command);
  } catch(error) {
    if(error instanceof TreatmentPlanConflict){
      return NextResponse.json({error:error.message,code:'TREATMENT_PLAN_CONFLICT',plan:await loadEpisodeTreatmentPlan(pool,params.id,true)},{status:409});
    }
    throw error;
  }
  const plan=(await loadEpisodeTreatmentPlan(pool,params.id,true))!;
  await logActivity(req, auth.email, 'episode_treatment_plan_updated', JSON.stringify({ episodeId: params.id, version: plan.version }), { skipAdminNotificationQueue: true });
  return NextResponse.json({ plan }, { headers: { 'Cache-Control': 'private, no-store' } });
});
