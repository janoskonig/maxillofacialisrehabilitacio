import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import {
  findNextUpcomingDraftSession,
  getUserInstitution,
  isPatientOnConsiliumSession,
} from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const institutionId = await getUserInstitution(auth);
  const { searchParams } = new URL(req.url);
  const patientRaw = searchParams.get('patientId');
  const patientParsed = z.string().uuid().safeParse(patientRaw);

  const session = await findNextUpcomingDraftSession(institutionId);
  if (!session) {
    return NextResponse.json({ session: null });
  }

  if (patientParsed.success) {
    const alreadyOnList = await isPatientOnConsiliumSession(session.id, patientParsed.data);
    return NextResponse.json({ session, alreadyOnList });
  }

  return NextResponse.json({ session });
});
