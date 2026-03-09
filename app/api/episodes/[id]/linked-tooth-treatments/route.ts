import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/linked-tooth-treatments
 * Returns tooth treatments linked to this episode, with info about whether
 * they are already in the episode_steps pathway.
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT tt.id, tt.tooth_number as "toothNumber", tt.treatment_code as "treatmentCode",
            tt.status, tt.notes,
            ttc.label_hu as "labelHu",
            CASE WHEN es.id IS NOT NULL THEN true ELSE false END as "inSteps"
     FROM tooth_treatments tt
     JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code
     LEFT JOIN episode_steps es ON es.tooth_treatment_id = tt.id AND es.episode_id = $1
     WHERE tt.episode_id = $1
     ORDER BY tt.tooth_number, ttc.sort_order`,
    [episodeId]
  );

  return NextResponse.json({ treatments: result.rows });
});
