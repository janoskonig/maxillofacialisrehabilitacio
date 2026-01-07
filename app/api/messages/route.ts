import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { sendMessage, getPatientMessages } from '@/lib/communication';
import { sendNewMessageNotification } from '@/lib/email';
import { getPatientForNotification, getDoctorForNotification } from '@/lib/communication';
import { logActivityWithAuth } from '@/lib/activity';
import { getDbPool } from '@/lib/db';

/**
 * POST /api/messages - Új üzenet küldése
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId, subject, message } = body;

    // Validáció
    if (!patientId || !message || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Beteg ID és üzenet tartalma kötelező' },
        { status: 400 }
      );
    }

    // Ellenőrizzük, hogy ki küldi az üzenetet
    const auth = await verifyAuth(request);
    const patientSessionId = await verifyPatientPortalSession(request);

    let senderType: 'doctor' | 'patient';
    let senderId: string;
    let senderEmail: string;
    let senderName: string | null = null;

    if (auth) {
      // Orvos küldi
      senderType = 'doctor';
      senderId = auth.userId;
      senderEmail = auth.email;
      
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

      // Admin vagy a kezelőorvos küldhet üzenetet
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
            { error: 'Nincs jogosultsága üzenetet küldeni ennek a betegnek' },
            { status: 403 }
          );
        }
      }

      // Orvos neve
      const userResult = await pool.query(
        `SELECT doktor_neve FROM users WHERE id = $1`,
        [auth.userId]
      );
      senderName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : auth.email;
    } else if (patientSessionId) {
      // Beteg küldi
      senderType = 'patient';
      senderId = patientSessionId;
      
      // Ellenőrizzük, hogy a beteg a saját üzenetét küldi-e
      if (patientSessionId !== patientId) {
        return NextResponse.json(
          { error: 'Csak saját magának küldhet üzenetet' },
          { status: 403 }
        );
      }

      const pool = getDbPool();
      const patientResult = await pool.query(
        `SELECT email, nev FROM patients WHERE id = $1`,
        [patientId]
      );

      if (patientResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Beteg nem található' },
          { status: 404 }
        );
      }

      senderEmail = patientResult.rows[0].email || '';
      senderName = patientResult.rows[0].nev;
    } else {
      return NextResponse.json(
        { error: 'Nincs jogosultsága üzenetet küldeni' },
        { status: 401 }
      );
    }

    // Üzenet küldése
    const newMessage = await sendMessage({
      patientId,
      senderType,
      senderId,
      senderEmail,
      subject: subject || null,
      message: message.trim(),
    });

    // Activity log
    if (auth) {
      await logActivityWithAuth(
        request,
        auth,
        'message_sent',
        `Üzenet küldve betegnek: ${patientId}`
      );
    }

    // Email értesítés küldése
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
        (request.headers.get('origin') || 'http://localhost:3000');

      if (senderType === 'doctor') {
        // Orvos küldött → beteg kap értesítést
        const patient = await getPatientForNotification(patientId);
        if (patient && patient.email) {
          await sendNewMessageNotification(
            patient.email,
            patient.nev,
            patient.nem,
            senderName,
            'doctor',
            subject || null,
            message.trim(),
            baseUrl
          );
        }
      } else {
        // Beteg küldött → orvos kap értesítést
        const doctor = await getDoctorForNotification(patientId);
        if (doctor) {
          const patient = await getPatientForNotification(patientId);
          console.log(`[Messages] Email értesítés küldése orvosnak: ${doctor.email}`);
          await sendNewMessageNotification(
            doctor.email,
            doctor.name,
            null, // Orvos nem mezője nincs
            patient?.nev || senderName,
            'patient',
            subject || null,
            message.trim(),
            baseUrl
          );
          console.log(`[Messages] Email értesítés sikeresen elküldve orvosnak: ${doctor.email}`);
        } else {
          // Ha nincs kezelőorvos, adminoknak küldünk értesítést
          const pool = getDbPool();
          const adminResult = await pool.query(
            `SELECT email, doktor_neve FROM users WHERE role = 'admin' AND active = true`
          );
          
          if (adminResult.rows.length > 0) {
            const patient = await getPatientForNotification(patientId);
            // Első adminnak küldjük
            const admin = adminResult.rows[0];
            console.log(`[Messages] Beteg üzenet - kezelőorvos nem található, adminnak küldve: ${admin.email}`);
            await sendNewMessageNotification(
              admin.email,
              admin.doktor_neve || admin.email,
              null,
              patient?.nev || senderName,
              'patient',
              subject || null,
              message.trim(),
              baseUrl
            );
            console.log(`[Messages] Email értesítés sikeresen elküldve adminnak: ${admin.email}`);
          } else {
            console.warn(`[Messages] Beteg üzenet - kezelőorvos és admin sem található beteghez: ${patientId}`);
          }
        }
      }
    } catch (emailError) {
      console.error('Hiba az email értesítés küldésekor:', emailError);
      // Ne akadályozza meg az üzenet küldését, ha az email nem sikerül
    }

    return NextResponse.json({
      success: true,
      message: newMessage,
    });
  } catch (error: any) {
    console.error('Hiba az üzenet küldésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenet küldésekor' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/messages?patientId=xxx - Üzenetek lekérése
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const patientId = searchParams.get('patientId');
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
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
        { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
        { status: 401 }
      );
    }

    // Ha beteg kéri, csak a saját üzeneteit láthatja
    if (patientSessionId && patientSessionId !== patientId) {
      return NextResponse.json(
        { error: 'Csak saját üzeneteit tekintheti meg' },
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
            { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
            { status: 403 }
          );
        }
      }
    }

    // Üzenetek lekérése
    const messages = await getPatientMessages(patientId, {
      unreadOnly,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      messages,
    });
  } catch (error: any) {
    console.error('Hiba az üzenetek lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenetek lekérésekor' },
      { status: 500 }
    );
  }
}

