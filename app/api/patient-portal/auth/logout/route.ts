import { NextResponse } from 'next/server';
import { clearPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (_req, { correlationId }) => {
  await clearPatientPortalSession();

  return NextResponse.json({
    success: true,
    message: 'Sikeresen kijelentkezett',
  });
});
