import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { collectTmkHealth } from '@/lib/tmk/health';

export const dynamic = 'force-dynamic';

/** GET /api/admin/tmk/health — operational SLO health vs TMK targets */
export const GET = roleHandler(['admin'], async () => {
  const report = await collectTmkHealth();
  return NextResponse.json(report);
});
