import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { logActivity } from '@/lib/activity';
import {
  createOpenEpisodeWithInitialStageZero,
  EPISODE_REASON_VALUES,
} from '@/lib/patient-episode-create';

/**
 * Új ellátási epizód (ugyanaz, mint POST /api/patients/[id]/episodes).
 * POST /api/patients/[id]/stages/new-episode
 * Body: { reason?, chiefComplaint?, caseTitle?, notes?, parentEpisodeId?, triggerType?, treatmentTypeId? }
 * Ha reason/chiefComplaint hiányzik: anamnesis + notes alapú feltöltés (API-kompatibilitás).
 */
export const dynamic = 'force-dynamic';

export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_episodes'`,
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ error: 'patient_episodes tábla nem létezik – futtasd a migrációt' }, { status: 503 });
  }

  const body = await req.json();
  const allowedReasons = new Set<string>(EPISODE_REASON_VALUES);
  let reason = body.reason as string | undefined;
  let chiefComplaint = (body.chiefComplaint as string)?.trim?.() || '';

  const anamnesis = await pool.query(
    `SELECT kezelesre_erkezes_indoka as reason FROM patient_anamnesis WHERE patient_id = $1`,
    [patientId],
  );
  const anReason = anamnesis.rows[0]?.reason as string | undefined;

  if (!reason || !allowedReasons.has(reason)) {
    const r = anReason?.trim?.();
    if (r && allowedReasons.has(r)) {
      reason = r;
    } else {
      reason = 'onkológiai kezelés utáni állapot';
    }
  }

  if (!chiefComplaint) {
    const fromNotes = (body.notes as string)?.trim?.();
    chiefComplaint = fromNotes || 'Új ellátási epizód (API)';
  }

  const caseTitle = (body.caseTitle as string)?.trim?.() || null;
  const parentEpisodeId = (body.parentEpisodeId as string) || null;
  const triggerType = (body.triggerType as string) || null;
  const treatmentTypeId = (body.treatmentTypeId as string)?.trim?.() || null;

  try {
    const episode = await createOpenEpisodeWithInitialStageZero(pool, {
      patientId,
      reason,
      chiefComplaint,
      caseTitle,
      parentEpisodeId,
      triggerType,
      treatmentTypeId,
      createdBy: auth.email,
    });

    await logActivity(
      req,
      auth.email,
      'patient_episode_started',
      JSON.stringify({ patientId, episodeId: episode.id, reason }),
    );

    return NextResponse.json(
      {
        episode,
        episodeId: episode.id,
        message: 'Új epizód sikeresen elindítva',
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: 'Epizód létrehozása sikertelen' }, { status: 500 });
  }
});
