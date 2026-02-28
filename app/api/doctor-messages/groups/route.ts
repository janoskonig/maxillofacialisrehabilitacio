import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';
import { createDoctorMessageGroup, getDoctorMessageGroups, getGroupMessages, renameDoctorMessageGroup } from '@/lib/doctor-communication';
import { logActivityWithAuth } from '@/lib/activity';

/**
 * POST /api/doctor-messages/groups - Új csoportos beszélgetés létrehozása
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { participantIds, name } = body;

    // Validáció
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return NextResponse.json(
        { error: 'Legalább egy résztvevő megadása kötelező' },
        { status: 400 }
      );
    }

    // No limit on participants - allow unlimited participants

    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága csoportos beszélgetést létrehozni' },
        { status: 401 }
      );
    }

    // Create group (creator is automatically added)
    const groupId = await createDoctorMessageGroup(
      auth.userId,
      participantIds,
      name || null
    );

    // Activity log
    await logActivityWithAuth(
      request,
      auth,
      'doctor_group_created',
      `Csoportos beszélgetés létrehozva: ${name || 'Névtelen csoport'} (${participantIds.length + 1} résztvevő)`
    );

    return NextResponse.json({
      success: true,
      groupId,
    });
  } catch (error: any) {
    logger.error('Hiba a csoportos beszélgetés létrehozásakor:', error);
    return NextResponse.json(
      { error: error.message || 'Hiba történt a csoportos beszélgetés létrehozásakor' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/doctor-messages/groups - Felhasználó csoportos beszélgetéseinek lekérése
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a csoportos beszélgetések megtekintéséhez' },
        { status: 401 }
      );
    }

    const groups = await getDoctorMessageGroups(auth.userId);

    return NextResponse.json({
      success: true,
      groups,
    });
  } catch (error: any) {
    logger.error('Hiba a csoportos beszélgetések lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a csoportos beszélgetések lekérésekor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/doctor-messages/groups/[groupId] - Csoportos beszélgetés átnevezése
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const { groupId } = params;
    const body = await request.json();
    const { name } = body;

    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a csoportos beszélgetés módosításához' },
        { status: 401 }
      );
    }

    await renameDoctorMessageGroup(groupId, name || null, auth.userId);

    // Activity log
    await logActivityWithAuth(
      request,
      auth,
      'doctor_group_renamed',
      `Csoportos beszélgetés átnevezve: ${name || 'Névtelen csoport'}`
    );

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    logger.error('Hiba a csoportos beszélgetés átnevezésekor:', error);
    return NextResponse.json(
      { error: error.message || 'Hiba történt a csoportos beszélgetés átnevezésekor' },
      { status: 500 }
    );
  }
}

