import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { markOpenStaffTasksViewed } from '@/lib/user-tasks';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (_req, { auth }) => {
  const updated = await markOpenStaffTasksViewed(auth.userId);
  return NextResponse.json({ success: true, updated });
});
