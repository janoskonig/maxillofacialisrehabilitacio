import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { renameDoctorMessageGroup, deleteDoctorMessageGroup } from '@/lib/doctor-communication';
import { logActivityWithAuth } from '@/lib/activity';

/**
 * PATCH /api/doctor-messages/groups/[groupId] - Csoportos beszélgetés átnevezése
 */
export const dynamic = 'force-dynamic';

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
    console.error('Hiba a csoportos beszélgetés átnevezésekor:', error);
    return NextResponse.json(
      { error: error.message || 'Hiba történt a csoportos beszélgetés átnevezésekor' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/doctor-messages/groups/[groupId] - Csoportos beszélgetés törlése
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const { groupId } = params;

    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a csoportos beszélgetés törléséhez' },
        { status: 401 }
      );
    }

    await deleteDoctorMessageGroup(groupId, auth.userId);

    // Activity log
    await logActivityWithAuth(
      request,
      auth,
      'doctor_group_deleted',
      `Csoportos beszélgetés törölve`
    );

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    console.error('Hiba a csoportos beszélgetés törlésekor:', error);
    return NextResponse.json(
      { error: error.message || 'Hiba történt a csoportos beszélgetés törlésekor' },
      { status: 500 }
    );
  }
}

