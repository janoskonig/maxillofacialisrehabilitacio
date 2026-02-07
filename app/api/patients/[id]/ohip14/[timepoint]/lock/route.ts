import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { getCurrentEpisodeAndStage } from '@/lib/ohip14-stage';
import { OHIP14Timepoint } from '@/lib/types';
import { logActivity } from '@/lib/activity';

/**
 * Lock patient's OHIP-14 response (prevent patient from modifying)
 * POST /api/patients/[id]/ohip14/[timepoint]/lock
 */
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; timepoint: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Only admin and doctors can lock
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a kérdőív lezárásához' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;
    const timepoint = params.timepoint as OHIP14Timepoint;

    if (!['T0', 'T1', 'T2'].includes(timepoint)) {
      return NextResponse.json(
        { error: 'Érvénytelen timepoint' },
        { status: 400 }
      );
    }

    const { episodeId: activeEpisodeId } = await getCurrentEpisodeAndStage(pool, patientId);

    if (!activeEpisodeId) {
      return NextResponse.json(
        { error: 'Nincs aktív epizód' },
        { status: 400 }
      );
    }

    // Find response
    const findResult = await pool.query(
      `SELECT id, locked_at 
       FROM ohip14_responses
       WHERE patient_id = $1
         AND timepoint = $2
         AND episode_id = $3`,
      [patientId, timepoint, activeEpisodeId]
    );

    if (findResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Kérdőív nem található' },
        { status: 404 }
      );
    }

    if (findResult.rows[0].locked_at) {
      return NextResponse.json(
        { error: 'A kérdőív már le van zárva' },
        { status: 400 }
      );
    }

    // Lock it
    await pool.query(
      `UPDATE ohip14_responses 
       SET locked_at = CURRENT_TIMESTAMP,
           updated_by = $1
       WHERE id = $2`,
      [auth.email, findResult.rows[0].id]
    );

    await logActivity(
      request,
      auth.email,
      'ohip14_locked',
      JSON.stringify({ patientId, timepoint, episodeId: activeEpisodeId })
    );

    return NextResponse.json({
      message: 'Kérdőív sikeresen lezárva',
      lockedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error locking OHIP-14 response:', error);
    return NextResponse.json(
      { error: 'Hiba történt a lezárás során' },
      { status: 500 }
    );
  }
}
