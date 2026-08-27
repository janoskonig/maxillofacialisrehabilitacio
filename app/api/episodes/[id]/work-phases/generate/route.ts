import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';
import { generateEpisodeWorkPhases } from '@/lib/generate-episode-work-phases';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/work-phases/generate — idempotent episode_work_phases generation.
 * Logic lives in lib/generate-episode-work-phases.ts (shared with activation + backfill).
 *
 * WP-0.7: explicit írásra szánt művelet — az olvasás a GET .../work-phases.
 * A testvér-route-okkal egyezően terv-mutációt csak a klinikai szerepek
 * végezhetnek (a korábbi authedHandler technikusnak is engedte).
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (_req, { params }) => {
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
      { error: 'Az epizódra nincs kezelési terv sablon alkalmazva (care_pathway). Először válasszon sablont.' },
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
