import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { addParticipantsToGroup, getGroupParticipants } from '@/lib/doctor-communication';
import { getDbPool } from '@/lib/db';
import { logActivityWithAuth } from '@/lib/activity';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doctor-messages/groups/[groupId]/participants - Csoport résztvevőinek lekérése
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const { groupId } = params;
  const pool = getDbPool();

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
});

/**
 * POST /api/doctor-messages/groups/[groupId]/participants - Résztvevők hozzáadása csoporthoz
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  const { groupId } = params;
  const body = await req.json();
  const { participantIds } = body;

  if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
    return NextResponse.json(
      { error: 'Legalább egy résztvevő megadása kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

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

  await addParticipantsToGroup(groupId, participantIds);

  await logActivityWithAuth(
    req,
    auth,
    'doctor_group_participants_added',
    `Résztvevők hozzáadva csoportos beszélgetéshez: ${participantIds.length} orvos`
  );

  return NextResponse.json({
    success: true,
  });
});
