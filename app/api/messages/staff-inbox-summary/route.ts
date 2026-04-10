import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getStaffInboxSummary } from '@/lib/staff-inbox-summary';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (_req, { auth }) => {
  const summary = await getStaffInboxSummary(auth.userId);
  return NextResponse.json({ success: true, ...summary });
});
