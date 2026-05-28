import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { resolveContextLinkViewer } from '@/lib/messaging/context-link-viewer';
import {
  MessageSearchError,
  parseDoctorSearchFilters,
  searchDoctorMessages,
} from '@/lib/messaging/search';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doctor-messages/search?q=...&recipientId=&groupId=&from=&to=&sender=&hasAttachment=...
 * Full-text search az orvos–orvos / csoport üzenetekben (Fázis 2.2).
 */
export const GET = apiHandler(async (req) => {
  const viewer = await resolveContextLinkViewer(req);
  if (!viewer) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }
  if (viewer.kind === 'patient_portal') {
    return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
  }

  let filters;
  try {
    filters = parseDoctorSearchFilters(req.nextUrl.searchParams);
  } catch (e) {
    if (e instanceof MessageSearchError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }

  if (filters.recipientId && filters.groupId) {
    return NextResponse.json(
      { error: 'recipientId és groupId egyszerre nem adható meg', code: 'INVALID_SCOPE' },
      { status: 400 },
    );
  }

  try {
    const result = await searchDoctorMessages(viewer, filters);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    if (e instanceof MessageSearchError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
});
