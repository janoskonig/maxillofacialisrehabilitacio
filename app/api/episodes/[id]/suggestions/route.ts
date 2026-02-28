import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import {
  computeAndPersistSuggestion,
  getCurrentSuggestion,
  dismissSuggestion,
} from '@/lib/stage-suggestion-service';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/suggestions — get current stage suggestion
 * POST /api/episodes/:id/suggestions — force recompute
 * DELETE /api/episodes/:id/suggestions — dismiss current suggestion
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const episodeId = params.id;
    const suggestion = await getCurrentSuggestion(episodeId);
    return NextResponse.json({ suggestion });
  } catch (error) {
    logger.error('Error in GET /episodes/:id/suggestions:', error);
    return NextResponse.json(
      { error: 'Hiba történt a javaslat lekérdezésekor' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

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
  } catch (error) {
    logger.error('Error in POST /episodes/:id/suggestions:', error);
    return NextResponse.json(
      { error: 'Hiba történt a javaslat számításakor' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const episodeId = params.id;
    const body = await request.json().catch(() => ({}));
    const dedupeKey = (body as Record<string, unknown>).dedupeKey as string;
    const ttlDays = ((body as Record<string, unknown>).ttlDays as number) || 14;

    if (!dedupeKey) {
      return NextResponse.json({ error: 'dedupeKey kötelező' }, { status: 400 });
    }

    await dismissSuggestion(episodeId, dedupeKey, auth.email, ttlDays);
    return NextResponse.json({ dismissed: true });
  } catch (error) {
    logger.error('Error in DELETE /episodes/:id/suggestions:', error);
    return NextResponse.json(
      { error: 'Hiba történt a javaslat elutasításakor' },
      { status: 500 }
    );
  }
}
