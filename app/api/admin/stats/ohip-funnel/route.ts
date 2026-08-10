import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getOhipFunnelReport } from '@/lib/ohip14-funnel';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stats/ohip-funnel
 * OHIP-14 válaszarány-tölcsér: időpontonként (T0–T5) jogosult → emlékeztetett →
 * eszkalált → kitöltött, plusz kezelőorvosonkénti kitöltési arány.
 * Élő számítás — ugyanaz a jogosultsági logika, mint az emlékeztető-jobé.
 */
export const GET = roleHandler(['admin'], async () => {
  const report = await getOhipFunnelReport();
  return NextResponse.json({ success: true, ...report });
});
