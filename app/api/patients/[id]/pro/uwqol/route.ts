import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  scoreUwqol,
  isValidDomainScore,
  UWQOL_DOMAIN_KEYS,
  UWQOL_INSTRUMENT_CODE,
} from '@/lib/pro/uwqol';

export const dynamic = 'force-dynamic';

const TIMEPOINTS = new Set(['T0', 'T1', 'T2', 'T3']);

/**
 * GET /api/patients/[id]/pro/uwqol
 * A beteg UW-QOL kitöltései timepointonként (legutóbbi felül).
 */
export const GET = roleHandler(['admin', 'fogpótlástanász'], async (_req, { params }) => {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT id, episode_id, timepoint, answers, scores, composite_score,
            completed_by_patient, completed_at, created_at, updated_at
       FROM pro_responses
      WHERE patient_id = $1 AND instrument = $2
      ORDER BY timepoint ASC, completed_at DESC NULLS LAST`,
    [params.id, UWQOL_INSTRUMENT_CODE],
  );
  return NextResponse.json({ success: true, responses: rows });
});

/**
 * POST /api/patients/[id]/pro/uwqol
 * UW-QOL kitöltés rögzítése/frissítése. Test:
 *   { timepoint: 'T0'..'T3', episodeId?: uuid, answers: { domén: 0..100 },
 *     completedByPatient?: boolean }
 * A doménenkénti 0–100 pontszámokból szerver oldalon számoljuk az alskálákat és
 * a kompozitot (a védett opció→pontszám konverziót a klinikus végzi az eszközön).
 */
export const POST = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth, params }) => {
  const body = (await req.json().catch(() => null)) as
    | { timepoint?: unknown; episodeId?: unknown; answers?: unknown; completedByPatient?: unknown }
    | null;

  const timepoint = typeof body?.timepoint === 'string' ? body.timepoint : '';
  if (!TIMEPOINTS.has(timepoint)) {
    throw new HttpError(400, 'Érvénytelen timepoint (T0–T3)', 'INVALID_TIMEPOINT');
  }

  const rawAnswers =
    body?.answers && typeof body.answers === 'object' ? (body.answers as Record<string, unknown>) : {};

  // Csak az ismert doméneket és csak az érvényes 0–100 értékeket fogadjuk el.
  const answers: Record<string, number> = {};
  for (const key of UWQOL_DOMAIN_KEYS) {
    const v = rawAnswers[key];
    if (v == null || v === '') continue;
    const num = typeof v === 'number' ? v : Number(v);
    if (!isValidDomainScore(num)) {
      throw new HttpError(400, `Érvénytelen pontszám (${key}): 0–100 közötti szám kell`, 'INVALID_SCORE');
    }
    answers[key] = num;
  }

  const scores = scoreUwqol(answers);
  const episodeId = typeof body?.episodeId === 'string' && body.episodeId ? body.episodeId : null;
  const completedByPatient = body?.completedByPatient === true;

  const pool = getDbPool();
  const { rows } = await pool.query(
    `INSERT INTO pro_responses
       (patient_id, episode_id, instrument, timepoint, answers, scores, composite_score,
        completed_by_patient, completed_at, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, NOW(), $9)
     ON CONFLICT (patient_id, episode_id, instrument, timepoint)
     DO UPDATE SET answers = EXCLUDED.answers,
                   scores = EXCLUDED.scores,
                   composite_score = EXCLUDED.composite_score,
                   completed_by_patient = EXCLUDED.completed_by_patient,
                   completed_at = NOW(),
                   updated_at = NOW()
     RETURNING id, timepoint, scores, composite_score`,
    [
      params.id,
      episodeId,
      UWQOL_INSTRUMENT_CODE,
      timepoint,
      JSON.stringify(answers),
      JSON.stringify(scores),
      scores.composite,
      completedByPatient,
      auth.email ?? null,
    ],
  );

  return NextResponse.json({ success: true, response: rows[0], scores });
});
