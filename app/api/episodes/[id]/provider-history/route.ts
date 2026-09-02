import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { listProviderAssignmentEvents } from '@/lib/episode-provider';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/provider-history — a felelős orvos váltásai az epizód
 * folyamán (legfrissebb elöl). A PATCH /api/episodes/:id assignedProviderId
 * írja a provider_assignment_events sorokat.
 */
export const GET = authedHandler(async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();
  const ep = await pool.query(`SELECT id FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (ep.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  const events = await listProviderAssignmentEvents(pool, episodeId);
  return NextResponse.json({ events });
});
