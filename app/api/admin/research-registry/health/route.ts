import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { collectRegistryHealth } from '@/lib/research-registry/health';

export const dynamic = 'force-dynamic';

/** GET /api/admin/research-registry/health — operational SLO health vs registry targets */
export const GET = roleHandler(['admin'], async () => {
  const report = await collectRegistryHealth();
  return NextResponse.json(report);
});
