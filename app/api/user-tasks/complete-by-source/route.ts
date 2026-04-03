import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { completeDocumentTasksBySourceMessage } from '@/lib/user-tasks';
import { validateUUID } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { sourceMessageId, sourceDoctorMessageId } = body as {
    sourceMessageId?: string | null;
    sourceDoctorMessageId?: string | null;
  };

  let srcMsg: string | null = null;
  let srcDoc: string | null = null;
  try {
    if (sourceMessageId) srcMsg = validateUUID(sourceMessageId, 'Üzenet ID');
    if (sourceDoctorMessageId) srcDoc = validateUUID(sourceDoctorMessageId, 'Orvosi üzenet ID');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Érvénytelen ID';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!srcMsg && !srcDoc) {
    return NextResponse.json({ error: 'sourceMessageId vagy sourceDoctorMessageId kötelező' }, { status: 400 });
  }

  const auth = await verifyAuth(req);
  const patientSession = await verifyPatientPortalSession(req);

  if (!auth && !patientSession) {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 401 });
  }

  const n = await completeDocumentTasksBySourceMessage({
    sourceMessageId: srcMsg,
    sourceDoctorMessageId: srcDoc,
    patientSessionId: patientSession || null,
    staffUserId: auth?.userId ?? null,
    staffEmail: auth?.email ?? null,
    staffRole: auth?.role ?? null,
  });

  return NextResponse.json({ success: true, completedCount: n });
});
