import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getStaffOpenTaskSummary } from '@/lib/user-tasks';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (_req, { auth }) => {
  const summary = await getStaffOpenTaskSummary(auth.userId);
  return NextResponse.json({ success: true, ...summary });
});
