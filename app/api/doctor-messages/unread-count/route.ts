import { NextRequest, NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getUnreadDoctorMessageCount } from '@/lib/doctor-communication';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const count = await getUnreadDoctorMessageCount(auth.userId);

  return NextResponse.json({
    success: true,
    count,
  });
});
