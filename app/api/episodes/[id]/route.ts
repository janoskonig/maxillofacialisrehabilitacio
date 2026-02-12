import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { invalidateIntentsForEpisode } from '@/lib/intent-invalidation';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/episodes/:id — update episode (care_pathway_id, care_pathway_version, assigned_provider_id)
 * When care_pathway_id or care_pathway_version changes, invalidates open slot_intents.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultsága az epizód módosításához' }, { status: 403 });
    }

    const episodeId = params.id;
    const body = await request.json();

    const { carePathwayId, carePathwayVersion, assignedProviderId } = body;
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (carePathwayId !== undefined) {
      updates.push(`care_pathway_id = $${idx}`);
      values.push(carePathwayId || null);
      idx++;
    }
    if (carePathwayVersion !== undefined) {
      updates.push(`care_pathway_version = $${idx}`);
      values.push(carePathwayVersion ?? null);
      idx++;
    }
    if (assignedProviderId !== undefined) {
      updates.push(`assigned_provider_id = $${idx}`);
      values.push(assignedProviderId || null);
      idx++;
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nincs módosítandó mező' }, { status: 400 });
    }

    const pool = getDbPool();

    const before = await pool.query(
      `SELECT care_pathway_id, care_pathway_version, assigned_provider_id FROM patient_episodes WHERE id = $1`,
      [episodeId]
    );
    if (before.rows.length === 0) {
      return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
    }
    const prev = before.rows[0];

    const pathwayChanged =
      (carePathwayId !== undefined && String(prev.care_pathway_id ?? '') !== String(carePathwayId ?? '')) ||
      (carePathwayVersion !== undefined && prev.care_pathway_version !== carePathwayVersion);
    const providerChanged =
      assignedProviderId !== undefined && String(prev.assigned_provider_id ?? '') !== String(assignedProviderId ?? '');

    values.push(episodeId);
    await pool.query(
      `UPDATE patient_episodes SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    if (pathwayChanged) {
      try {
        await invalidateIntentsForEpisode(episodeId, 'pathway_changed');
      } catch (e) {
        console.error('Failed to invalidate intents on pathway change:', e);
      }
    }
    if (providerChanged) {
      try {
        await invalidateIntentsForEpisode(episodeId, 'provider_changed');
      } catch (e) {
        console.error('Failed to invalidate intents on provider change:', e);
      }
    }

    const after = await pool.query(
      `SELECT id, care_pathway_id as "carePathwayId", care_pathway_version as "carePathwayVersion", assigned_provider_id as "assignedProviderId" FROM patient_episodes WHERE id = $1`,
      [episodeId]
    );

    return NextResponse.json({ episode: after.rows[0] });
  } catch (error) {
    console.error('Error updating episode:', error);
    return NextResponse.json(
      { error: 'Hiba történt az epizód módosításakor' },
      { status: 500 }
    );
  }
}
