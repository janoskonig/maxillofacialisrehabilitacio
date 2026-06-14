import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';
import { generateEpisodeWorkPhases } from '@/lib/generate-episode-work-phases';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/work-phases/generate — idempotent episode_work_phases generation.
 * Logic lives in lib/generate-episode-work-phases.ts (shared with activation + backfill).
 */
export const POST = authedHandler(async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const result = await generateEpisodeWorkPhases(pool, episodeId);

  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (result.status === 'not_open') {
    return NextResponse.json({ error: 'Csak aktív epizódhoz generálható munkafázis' }, { status: 400 });
  }
  if (result.status === 'no_pathway') {
    return NextResponse.json(
      { error: 'Epizódhoz nincs hozzárendelve kezelési út (care_pathway). Először válasszon pathway-t.' },
      { status: 409 }
    );
  }

  const totalGenerated = result.totalGenerated;
  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);

  return NextResponse.json(
    {
      workPhases: allPhases.rows,
      generated: totalGenerated > 0,
      message: totalGenerated > 0 ? `${totalGenerated} munkafázis generálva` : 'Munkafázisok már léteznek',
    },
    { status: totalGenerated > 0 ? 201 : 200 }
  );
});
