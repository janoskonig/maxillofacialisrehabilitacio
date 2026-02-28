import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { getPatientCommunicationLogs, logCommunication, CommunicationType, CommunicationDirection } from '@/lib/communication-logs';
import { logActivityWithAuth } from '@/lib/activity';
import { getDbPool } from '@/lib/db';
import { apiHandler, authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  const searchParams = req.nextUrl.searchParams;
  const patientId = searchParams.get('patientId');
  const communicationType = searchParams.get('communicationType') as CommunicationType | null;
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;
  const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined;

  if (!patientId) {
    return NextResponse.json(
      { error: 'Beteg ID kötelező' },
      { status: 400 }
    );
  }

  const auth = await verifyAuth(req);
  const patientSessionId = await verifyPatientPortalSession(req);

  if (!auth && !patientSessionId) {
    return NextResponse.json(
      { error: 'Nincs jogosultsága az érintkezési napló megtekintéséhez' },
      { status: 401 }
    );
  }

  if (patientSessionId && !auth && patientSessionId !== patientId) {
    return NextResponse.json(
      { error: 'Csak saját érintkezési naplóját tekintheti meg' },
      { status: 403 }
    );
  }

  if (auth) {
    const pool = getDbPool();
    const patientResult = await pool.query(
      `SELECT id, kezeleoorvos FROM patients WHERE id = $1`,
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];
    if (auth.role !== 'admin' && patient.kezeleoorvos !== auth.email) {
      const userResult = await pool.query(
        `SELECT doktor_neve FROM users WHERE id = $1`,
        [auth.userId]
      );
      const userName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : null;
      
      if (patient.kezeleoorvos !== userName) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága az érintkezési napló megtekintéséhez' },
          { status: 403 }
        );
      }
    }
  }

  const logs = await getPatientCommunicationLogs(patientId, {
    communicationType: communicationType || undefined,
    limit,
    offset,
  });

  return NextResponse.json({
    success: true,
    logs,
  });
});

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  const { patientId, communicationType, direction, subject, content, metadata } = body;

  if (!patientId || !communicationType || !direction || !content) {
    return NextResponse.json(
      { error: 'Beteg ID, kommunikáció típusa, iránya és tartalma kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  const patientResult = await pool.query(
    `SELECT id, kezeleoorvos FROM patients WHERE id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  const patient = patientResult.rows[0];
  if (auth.role !== 'admin' && patient.kezeleoorvos !== auth.email) {
    const userResult = await pool.query(
      `SELECT name FROM users WHERE id = $1`,
      [auth.userId]
    );
    const userName = userResult.rows.length > 0 ? userResult.rows[0].name : null;
    
    if (patient.kezeleoorvos !== userName) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága érintkezési bejegyzést létrehozni ennek a betegnek' },
        { status: 403 }
      );
    }
  }

  const doctorId = auth.userId;

  const log = await logCommunication({
    patientId,
    doctorId,
    communicationType: communicationType as CommunicationType,
    direction: direction as CommunicationDirection,
    subject: subject || null,
    content: content.trim(),
    metadata: metadata || null,
    createdBy: auth.email,
  });

  await logActivityWithAuth(
    req,
    auth,
    'communication_log_created',
    `Érintkezési bejegyzés létrehozva betegnek: ${patientId}, típus: ${communicationType}`
  );

  return NextResponse.json({
    success: true,
    log,
  });
});
