import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { listPendingConsentPatients } from '@/lib/tmk/research-consent-service';
import { getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const centerOnly = req.nextUrl.searchParams.get('centerOnly') === 'true';
  const center =
    centerOnly && auth.role !== 'admin' ? await getUserInstitution(auth) : null;

  const patients = await listPendingConsentPatients(center);
  return NextResponse.json({ count: patients.length, patients });
});
