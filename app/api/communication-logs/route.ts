import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { getPatientCommunicationLogs, logCommunication, CommunicationType, CommunicationDirection } from '@/lib/communication-logs';
import { logActivityWithAuth } from '@/lib/activity';
import { getDbPool } from '@/lib/db';

/**
 * GET /api/communication-logs?patientId=xxx - Érintkezési napló lekérése
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
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

    // Ellenőrizzük a jogosultságot
    const auth = await verifyAuth(request);
    const patientSessionId = await verifyPatientPortalSession(request);

    if (!auth && !patientSessionId) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az érintkezési napló megtekintéséhez' },
        { status: 401 }
      );
    }

    // Ha beteg kéri (és NINCS orvos session), csak a saját naplóját láthatja
    // Ha orvos van bejelentkezve, akkor az orvos jogosultság-ellenőrzés fut le később
    if (patientSessionId && !auth && patientSessionId !== patientId) {
      return NextResponse.json(
        { error: 'Csak saját érintkezési naplóját tekintheti meg' },
        { status: 403 }
      );
    }

    // Ha orvos kéri, ellenőrizzük a hozzáférést
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
        // Ellenőrizzük, hogy a user doktor_neve mezője egyezik-e
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

    // Érintkezési napló lekérése
    const logs = await getPatientCommunicationLogs(patientId, {
      communicationType: communicationType || undefined,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      logs,
    });
  } catch (error: any) {
    console.error('[API] Hiba az érintkezési napló lekérésekor:', {
      error: error.message,
      stack: error.stack,
      patientId: request.nextUrl.searchParams.get('patientId')
    });
    return NextResponse.json(
      { error: 'Hiba történt az érintkezési napló lekérésekor' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/communication-logs - Manuális érintkezési bejegyzés létrehozása
 * Csak orvosok számára (telefonhívások, személyes találkozók naplózása)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId, communicationType, direction, subject, content, metadata } = body;

    // Validáció
    if (!patientId || !communicationType || !direction || !content) {
      return NextResponse.json(
        { error: 'Beteg ID, kommunikáció típusa, iránya és tartalma kötelező' },
        { status: 400 }
      );
    }

    // Csak orvosok hozhatnak létre manuális bejegyzést
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Csak orvosok hozhatnak létre manuális érintkezési bejegyzést' },
        { status: 401 }
      );
    }

    // Ellenőrizzük, hogy az orvos hozzáférhet-e a beteghez
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
      // Ellenőrizzük, hogy a user name mezője egyezik-e
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

    // Orvos ID lekérése
    const doctorId = auth.userId;

    // Érintkezési napló létrehozása
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

    // Activity log
    await logActivityWithAuth(
      request,
      auth,
      'communication_log_created',
      `Érintkezési bejegyzés létrehozva betegnek: ${patientId}, típus: ${communicationType}`
    );

    return NextResponse.json({
      success: true,
      log,
    });
  } catch (error: any) {
    console.error('Hiba az érintkezési bejegyzés létrehozásakor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az érintkezési bejegyzés létrehozásakor' },
      { status: 500 }
    );
  }
}

