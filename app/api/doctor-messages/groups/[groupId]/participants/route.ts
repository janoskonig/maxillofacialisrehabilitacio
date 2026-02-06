import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { addParticipantsToGroup, getGroupParticipants } from '@/lib/doctor-communication';
import { getDbPool } from '@/lib/db';
import { logActivityWithAuth } from '@/lib/activity';

/**
 * GET /api/doctor-messages/groups/[groupId]/participants - Csoport résztvevőinek lekérése
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const { groupId } = params;

    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a résztvevők megtekintéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Verify user is a participant
    const participantResult = await pool.query(
      `SELECT user_id FROM doctor_message_group_participants WHERE group_id = $1 AND user_id = $2`,
      [groupId, auth.userId]
    );

    if (participantResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a csoportos beszélgetés megtekintéséhez' },
        { status: 403 }
      );
    }

    const participants = await getGroupParticipants(groupId);

    // Get group creator
    const groupResult = await pool.query(
      `SELECT created_by FROM doctor_message_groups WHERE id = $1`,
      [groupId]
    );
    const createdBy = groupResult.rows.length > 0 ? groupResult.rows[0].created_by : null;

    return NextResponse.json({
      success: true,
      participants,
      createdBy,
    });
  } catch (error: any) {
    console.error('Hiba a résztvevők lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a résztvevők lekérésekor' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/doctor-messages/groups/[groupId]/participants - Résztvevők hozzáadása csoporthoz
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const { groupId } = params;
    const body = await request.json();
    const { participantIds } = body;

    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return NextResponse.json(
        { error: 'Legalább egy résztvevő megadása kötelező' },
        { status: 400 }
      );
    }

    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága résztvevőket hozzáadni' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Verify user is a participant (and optionally check if they're the creator)
    const participantResult = await pool.query(
      `SELECT user_id FROM doctor_message_group_participants WHERE group_id = $1 AND user_id = $2`,
      [groupId, auth.userId]
    );

    if (participantResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága résztvevőket hozzáadni ehhez a csoporthoz' },
        { status: 403 }
      );
    }

    // Add participants
    await addParticipantsToGroup(groupId, participantIds);

    // Activity log
    await logActivityWithAuth(
      request,
      auth,
      'doctor_group_participants_added',
      `Résztvevők hozzáadva csoportos beszélgetéshez: ${participantIds.length} orvos`
    );

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    console.error('Hiba a résztvevők hozzáadásakor:', error);
    return NextResponse.json(
      { error: error.message || 'Hiba történt a résztvevők hozzáadásakor' },
      { status: 500 }
    );
  }
}

