import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { loadSchedulingRequests } from '@/lib/aftercare/service';

export const dynamic = 'force-dynamic';
export const GET = roleHandler(['admin', 'fogpótlástanász', 'beutalo_orvos'], async () => {
  const requests = await loadSchedulingRequests(getDbPool());
  return NextResponse.json({ requests: requests.filter((r) => !r.completed) }, { headers: { 'Cache-Control': 'no-store' } });
});
