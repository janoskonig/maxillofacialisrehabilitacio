import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { renameDoctorMessageGroup, deleteDoctorMessageGroup } from '@/lib/doctor-communication';
import { logActivityWithAuth } from '@/lib/activity';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/doctor-messages/groups/[groupId] - Csoportos beszélgetés átnevezése
 */
export const PATCH = authedHandler(async (req, { auth, params }) => {
  const { groupId } = params;
  const body = await req.json();
  const { name } = body;

  await renameDoctorMessageGroup(groupId, name || null, auth.userId);

  await logActivityWithAuth(
    req,
    auth,
    'doctor_group_renamed',
    `Csoportos beszélgetés átnevezve: ${name || 'Névtelen csoport'}`
  );

  return NextResponse.json({
    success: true,
  });
});

/**
 * DELETE /api/doctor-messages/groups/[groupId] - Csoportos beszélgetés törlése
 */
export const DELETE = authedHandler(async (req, { auth, params }) => {
  const { groupId } = params;

  await deleteDoctorMessageGroup(groupId, auth.userId);

  await logActivityWithAuth(
    req,
    auth,
    'doctor_group_deleted',
    `Csoportos beszélgetés törölve`
  );

  return NextResponse.json({
    success: true,
  });
});
