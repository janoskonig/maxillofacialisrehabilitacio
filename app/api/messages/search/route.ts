import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { hasEverTreatedPatient } from '@/lib/patient-doctor-access';
import { getDbPool } from '@/lib/db';
import { validateUUID } from '@/lib/validation';
import { resolveContextLinkViewer } from '@/lib/messaging/context-link-viewer';
import {
  MessageSearchError,
  parsePatientSearchFilters,
  searchPatientMessages,
} from '@/lib/messaging/search';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messages/search?q=...&patientId=&from=&to=&sender=&hasAttachment=&entityType=&entityId=
 * Full-text search a beteg–orvos üzenetekben (Fázis 2.2).
 */
export const GET = apiHandler(async (req) => {
  const viewer = await resolveContextLinkViewer(req);
  if (!viewer) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  let filters;
  try {
    filters = parsePatientSearchFilters(req.nextUrl.searchParams);
  } catch (e) {
    if (e instanceof MessageSearchError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }

  if (viewer.kind === 'patient_portal') {
    if (filters.patientId && filters.patientId !== viewer.patientId) {
      return NextResponse.json(
        { error: 'Csak saját üzeneteiben kereshet' },
        { status: 403 },
      );
    }
    filters = { ...filters, patientId: viewer.patientId };
  } else if (filters.patientId) {
    try {
      validateUUID(filters.patientId, 'patientId');
    } catch (validationError: unknown) {
      const message =
        validationError instanceof Error ? validationError.message : 'Érvénytelen patientId';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const pool = getDbPool();
    const patientResult = await pool.query(`SELECT id FROM patients WHERE id = $1`, [
      filters.patientId,
    ]);
    if (patientResult.rows.length === 0) {
      return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
    }

    if (viewer.role !== 'admin') {
      const allowed = await hasEverTreatedPatient(viewer.userId, filters.patientId);
      if (!allowed) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ebben a beteg szálában keresni' },
          { status: 403 },
        );
      }
    }
  }

  if (viewer.kind === 'patient_portal' && !filters.laneDoctorId) {
    const doctorIdParam = req.nextUrl.searchParams.get('doctorId');
    if (doctorIdParam) {
      try {
        filters = {
          ...filters,
          laneDoctorId: validateUUID(doctorIdParam, 'doctorId'),
        };
      } catch (validationError: unknown) {
        const message =
          validationError instanceof Error ? validationError.message : 'Érvénytelen doctorId';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }
  }

  try {
    const result = await searchPatientMessages(viewer, filters);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    if (e instanceof MessageSearchError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
});
