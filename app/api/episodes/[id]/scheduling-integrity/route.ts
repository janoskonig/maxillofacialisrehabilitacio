import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

type ViolationKind =
  | 'ONE_HARD_NEXT_VIOLATION'
  | 'INTENT_OPEN_EPISODE_CLOSED'
  | 'APPOINTMENT_NO_SLOT'
  | 'SLOT_DOUBLE_BOOKED';

interface Violation {
  kind: ViolationKind;
  message: string;
  appointmentIds?: string[];
  slotIds?: string[];
  intentIds?: string[];
}

/**
 * GET /api/episodes/:id/scheduling-integrity
 * Returns scheduling violations for this episode (diagnostic).
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
    const pool = getDbPool();

    const episodeResult = await pool.query(
      `SELECT pe.id, pe.status, pe.patient_id as "patientId"
       FROM patient_episodes pe
       WHERE pe.id = $1`,
      [episodeId]
    );

    if (episodeResult.rows.length === 0) {
      return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
    }

    const episode = episodeResult.rows[0];
    const violations: Violation[] = [];

    // 1) One-hard-next: >1 future work appointment (excluding requires_precommit)
    const oneHardNextResult = await pool.query(
      `SELECT id FROM appointments
       WHERE episode_id = $1 AND pool = 'work'
       AND start_time > CURRENT_TIMESTAMP
       AND (appointment_status IS NULL OR appointment_status = 'completed')
       AND requires_precommit = false`,
      [episodeId]
    );

    if (oneHardNextResult.rows.length > 1) {
      violations.push({
        kind: 'ONE_HARD_NEXT_VIOLATION',
        message: `Epizódnak ${oneHardNextResult.rows.length} jövőbeli munkafoglalása van (max 1 engedélyezett)`,
        appointmentIds: oneHardNextResult.rows.map((r: { id: string }) => r.id),
      });
    }

    // 2) Intents open but episode closed
    if (episode.status === 'closed') {
      const openIntentsResult = await pool.query(
        `SELECT id FROM slot_intents WHERE episode_id = $1 AND state = 'open'`,
        [episodeId]
      );
      if (openIntentsResult.rows.length > 0) {
        violations.push({
          kind: 'INTENT_OPEN_EPISODE_CLOSED',
          message: 'Nyitott intentek léteznek lezárt epizódhoz',
          intentIds: openIntentsResult.rows.map((r: { id: string }) => r.id),
        });
      }
    }

    // 3) Episode appointments without valid slot
    const apptNoSlotResult = await pool.query(
      `SELECT a.id FROM appointments a
       LEFT JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE a.episode_id = $1 AND ats.id IS NULL
       AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')`,
      [episodeId]
    );
    if (apptNoSlotResult.rows.length > 0) {
      violations.push({
        kind: 'APPOINTMENT_NO_SLOT',
        message: 'Foglalások léteznek slot nélkül',
        appointmentIds: apptNoSlotResult.rows.map((r: { id: string }) => r.id),
      });
    }

    return NextResponse.json({
      episodeId,
      status: episode.status,
      violations,
      ok: violations.length === 0,
    });
  } catch (error) {
    console.error('Error fetching scheduling integrity:', error);
    return NextResponse.json(
      { error: 'Hiba történt az integritás lekérdezésekor' },
      { status: 500 }
    );
  }
}
