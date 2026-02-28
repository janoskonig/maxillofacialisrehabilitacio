import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { RENEWAL_ESCALATION_THRESHOLD } from '@/lib/episode-block-taxonomy';
import { logger } from '@/lib/logger';

/**
 * POST /api/episode-blocks/:id/renew
 * Renew an episode block with typed reason + expected_unblock_date.
 * Escalation if renewal_count > 2.
 * Body: { reason, expectedUnblockDate }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultsága blokk megújításához' }, { status: 403 });
    }

    const blockId = params.id;
    const body = await request.json().catch(() => ({}));
    const { reason, expectedUnblockDate } = body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return NextResponse.json(
        { error: 'reason kötelező (min 5 karakter), pl. "Lab still processing" vagy "Healing extended"', hint: 'required' },
        { status: 400 }
      );
    }

    if (!expectedUnblockDate) {
      return NextResponse.json(
        { error: 'expectedUnblockDate kötelező' },
        { status: 400 }
      );
    }

    const expectedUnblock = new Date(expectedUnblockDate);
    if (isNaN(expectedUnblock.getTime())) {
      return NextResponse.json({ error: 'expectedUnblockDate érvénytelen dátum' }, { status: 400 });
    }

    const pool = getDbPool();

    const blockResult = await pool.query(
      `SELECT id, episode_id, key, renewal_count, active FROM episode_blocks WHERE id = $1`,
      [blockId]
    );

    if (blockResult.rows.length === 0) {
      return NextResponse.json({ error: 'Blokk nem található' }, { status: 404 });
    }

    const block = blockResult.rows[0];
    if (!block.active) {
      return NextResponse.json({ error: 'Blokk már nem aktív' }, { status: 400 });
    }

    const newRenewalCount = (block.renewal_count ?? 0) + 1;
    const escalation = newRenewalCount > RENEWAL_ESCALATION_THRESHOLD;

    const newExpiresAt = new Date(expectedUnblock);
    newExpiresAt.setDate(newExpiresAt.getDate() + 2);

    await pool.query(
      `UPDATE episode_blocks
       SET renewal_count = $1, expected_unblock_date = $2, expires_at = $3,
           note = COALESCE(note || E'\n', '') || $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [newRenewalCount, expectedUnblock, newExpiresAt, `[${new Date().toISOString()}] Renewal #${newRenewalCount}: ${reason.trim()}`, blockId]
    );

    const taskDue = new Date(expectedUnblock.getTime() - 2 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO episode_tasks (episode_id, task_type, due_at) VALUES ($1, 'unblock_check', $2)`,
      [block.episode_id, taskDue]
    );

    try {
      await emitSchedulingEvent('block', blockId, 'renewed');
    } catch {
      // Non-blocking
    }

    const updated = await pool.query(
      `SELECT id, episode_id as "episodeId", key, active, expires_at as "expiresAt",
              renewal_count as "renewalCount", expected_unblock_date as "expectedUnblockDate",
              note, updated_at as "updatedAt"
       FROM episode_blocks WHERE id = $1`,
      [blockId]
    );

    return NextResponse.json({
      block: updated.rows[0],
      renewalCount: newRenewalCount,
      escalation,
      escalationMessage: escalation
        ? `Blokk ${newRenewalCount}x megújítva. Admin felülvizsgálat javasolt.`
        : undefined,
    });
  } catch (error) {
    logger.error('Error renewing episode block:', error);
    return NextResponse.json(
      { error: 'Hiba történt a blokk megújításakor' },
      { status: 500 }
    );
  }
}
