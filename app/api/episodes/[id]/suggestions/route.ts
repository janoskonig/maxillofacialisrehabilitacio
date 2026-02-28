import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import {
  computeAndPersistSuggestion,
  getCurrentSuggestion,
  dismissSuggestion,
} from '@/lib/stage-suggestion-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/suggestions — get current stage suggestion
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const suggestion = await getCurrentSuggestion(episodeId);
  return NextResponse.json({ suggestion });
});

/**
 * POST /api/episodes/:id/suggestions — force recompute
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;

  const pool = getDbPool();
  const epCheck = await pool.query(
    `SELECT 1 FROM patient_episodes WHERE id = $1 AND status = 'open'`,
    [episodeId]
  );
  if (epCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található vagy nem aktív' }, { status: 404 });
  }

  const suggestion = await computeAndPersistSuggestion(episodeId);
  return NextResponse.json({ suggestion });
});

/**
 * DELETE /api/episodes/:id/suggestions — dismiss current suggestion
 */
export const DELETE = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json().catch(() => ({}));
  const dedupeKey = (body as Record<string, unknown>).dedupeKey as string;
  const ttlDays = ((body as Record<string, unknown>).ttlDays as number) || 14;

  if (!dedupeKey) {
    return NextResponse.json({ error: 'dedupeKey kötelező' }, { status: 400 });
  }

  await dismissSuggestion(episodeId, dedupeKey, auth.email, ttlDays);
  return NextResponse.json({ dismissed: true });
});
