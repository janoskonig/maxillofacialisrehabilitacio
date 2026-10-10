import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { probeColumnExists } from '@/lib/schema-probe';
import { isValidUUID } from '@/lib/validation';
import { logActivity } from '@/lib/activity';
import { parseEpisodeTreatmentPlanUpdate } from '@/lib/episode-treatment-plan';

export const dynamic = 'force-dynamic';

const SELECT_PLAN = `SELECT id AS "episodeId", treatment_plan AS "treatmentPlan",
  treatment_plan_upper AS "treatmentPlanUpper", treatment_plan_lower AS "treatmentPlanLower",
  treatment_plan_version AS version FROM patient_episodes WHERE id = $1`;

async function checkSchema() {
  const pool = getDbPool();
  const available = await Promise.all([
    probeColumnExists(pool, 'patient_episodes', 'treatment_plan'),
    probeColumnExists(pool, 'patient_episodes', 'treatment_plan_version'),
    probeColumnExists(pool, 'patient_episodes', 'treatment_plan_upper'),
    probeColumnExists(pool, 'patient_episodes', 'treatment_plan_lower'),
  ]);
  return available.every(Boolean);
}

function unavailable() {
  return NextResponse.json({ error: 'A kezelési terv mező még nem érhető el. Az adatbázis frissítése szükséges.', code: 'TREATMENT_PLAN_SCHEMA_UNAVAILABLE' }, { status: 503 });
}

export const GET = authedHandler(async (_req, { params }) => {
  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Érvénytelen epizódazonosító.' }, { status: 400 });
  if (!await checkSchema()) return unavailable();
  const result = await getDbPool().query(SELECT_PLAN, [params.id]);
  if (!result.rows.length) return NextResponse.json({ error: 'Epizód nem található.' }, { status: 404 });
  return NextResponse.json({ plan: result.rows[0] }, { headers: { 'Cache-Control': 'private, no-store' } });
});

// Saving a clinical description never regenerates steps, bookings or scheduling intents.
export const PATCH = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Érvénytelen epizódazonosító.' }, { status: 400 });
  const update = parseEpisodeTreatmentPlanUpdate(await req.json());
  if ('error' in update) return NextResponse.json({ error: update.error }, { status: 400 });
  if (!await checkSchema()) return unavailable();
  const pool = getDbPool();
  const isJawUpdate = update.mode === 'jaws';
  const setPlan = isJawUpdate ? 'treatment_plan_upper = $2, treatment_plan_lower = $3' : 'treatment_plan = $2';
  const versionIndex = isJawUpdate ? 4 : 3;
  const values = update.mode === 'jaws'
    ? [params.id, update.treatmentPlanUpper, update.treatmentPlanLower, update.expectedVersion]
    : [params.id, update.treatmentPlan, update.expectedVersion];
  const result = await pool.query(
    `UPDATE patient_episodes
       SET ${setPlan}, treatment_plan_version = treatment_plan_version + 1
     WHERE id = $1 AND treatment_plan_version = $${versionIndex}
     RETURNING id AS "episodeId", treatment_plan AS "treatmentPlan",
       treatment_plan_upper AS "treatmentPlanUpper", treatment_plan_lower AS "treatmentPlanLower", treatment_plan_version AS version`,
    values
  );
  if (!result.rows.length) {
    const current = await pool.query(SELECT_PLAN, [params.id]);
    if (!current.rows.length) return NextResponse.json({ error: 'Epizód nem található.' }, { status: 404 });
    return NextResponse.json({
      error: 'A kezelési tervet közben más módosította. Tekintse át a friss változatot.',
      code: 'TREATMENT_PLAN_CONFLICT', plan: current.rows[0],
    }, { status: 409 });
  }
  const plan = result.rows[0];
  await logActivity(req, auth.email, 'episode_treatment_plan_updated', JSON.stringify({ episodeId: params.id, version: plan.version }), { skipAdminNotificationQueue: true });
  return NextResponse.json({ plan }, { headers: { 'Cache-Control': 'private, no-store' } });
});
