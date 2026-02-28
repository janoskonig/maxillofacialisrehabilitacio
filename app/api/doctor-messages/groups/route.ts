import { NextRequest, NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { createDoctorMessageGroup, getDoctorMessageGroups, getGroupMessages, renameDoctorMessageGroup } from '@/lib/doctor-communication';
import { logActivityWithAuth } from '@/lib/activity';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  const { participantIds, name } = body;

  if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
    return NextResponse.json(
      { error: 'Legalább egy résztvevő megadása kötelező' },
      { status: 400 }
    );
  }

  const groupId = await createDoctorMessageGroup(
    auth.userId,
    participantIds,
    name || null
  );

  await logActivityWithAuth(
    req,
    auth,
    'doctor_group_created',
    `Csoportos beszélgetés létrehozva: ${name || 'Névtelen csoport'} (${participantIds.length + 1} résztvevő)`
  );

  return NextResponse.json({
    success: true,
    groupId,
  });
});

export const GET = authedHandler(async (req, { auth }) => {
  const groups = await getDoctorMessageGroups(auth.userId);

  return NextResponse.json({
    success: true,
    groups,
  });
});

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
