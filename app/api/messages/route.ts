import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession, getPatientPortalSessionInfo } from '@/lib/patient-portal-server';
import { sendMessage, getPatientMessages } from '@/lib/communication';
import { sendNewMessageNotification } from '@/lib/email';
import { getPatientForNotification, getDoctorForNotification } from '@/lib/communication';
import { logActivityWithAuth, logActivity } from '@/lib/activity';
import { getDbPool } from '@/lib/db';
import { emitNewMessage } from '@/lib/socket-server';

/**
 * POST /api/messages - Új üzenet küldése
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId, subject, message, recipientDoctorId } = body;

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
    let recipientDoctorIdFinal: string | null = null;

    // Ha van patientSessionId ÉS az megegyezik a patientId-vel, akkor a beteg küldi
    // (ez az impersonate eset is kezeli, mert akkor is van patientSessionId)
    if (patientSessionId && patientSessionId === patientId) {
      // Beteg küldi (akár impersonate módban is)
      senderType = 'patient';
      senderId = patientSessionId;
      
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
      
      // Validáció: ha nincs email, akkor nem küldhet üzenetet
      if (!senderEmail || senderEmail.trim() === '') {
        return NextResponse.json(
          { error: 'A betegnek nincs email címe, ezért nem küldhet üzenetet' },
          { status: 400 }
        );
      }

      // Beteg csak a kezelőorvosnak vagy az adminnak küldhet üzenetet
      // Először megkeressük a kezelőorvos ID-ját
      const patientData = patientResult.rows[0];
      let treatingDoctorId: string | null = null;
      
      if (patientData.kezeleoorvos) {
        const treatingDoctorResult = await pool.query(
          `SELECT id FROM users 
           WHERE (email = $1 OR doktor_neve = $1) AND active = true 
           LIMIT 1`,
          [patientData.kezeleoorvos]
        );
        if (treatingDoctorResult.rows.length > 0) {
          treatingDoctorId = treatingDoctorResult.rows[0].id;
        }
      }

      // Admin ID lekérése (első aktív admin)
      const adminResult = await pool.query(
        `SELECT id FROM users WHERE role = 'admin' AND active = true LIMIT 1`
      );
      const adminId = adminResult.rows.length > 0 ? adminResult.rows[0].id : null;

      // Ha a beteg megadott egy recipientDoctorId-t, ellenőrizzük, hogy csak kezelőorvos vagy admin lehet
      if (recipientDoctorId) {
        if (recipientDoctorId !== treatingDoctorId && recipientDoctorId !== adminId) {
          return NextResponse.json(
            { error: 'Csak a kezelőorvosnak vagy az adminnak küldhet üzenetet' },
            { status: 403 }
          );
        }

        // Ellenőrizzük, hogy létezik és aktív-e
        const doctorResult = await pool.query(
          `SELECT id, email, doktor_neve FROM users 
           WHERE id = $1 AND active = true`,
          [recipientDoctorId]
        );

        if (doctorResult.rows.length === 0) {
          return NextResponse.json(
            { error: 'A megadott orvos nem található vagy nem aktív' },
            { status: 404 }
          );
        }

        recipientDoctorIdFinal = recipientDoctorId;
      } else {
        // Ha nincs megadva, akkor a kezelőorvosnak küldjük, ha van, különben az adminnak
        recipientDoctorIdFinal = treatingDoctorId || adminId;
      }
    } else if (auth) {
      // Orvos küldi (csak akkor, ha nincs érvényes patientSessionId)
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
      recipientDoctorId: recipientDoctorIdFinal,
    });

    // Activity log
    if (auth) {
      await logActivityWithAuth(
        request,
        auth,
        'message_sent',
        `Üzenet küldve betegnek: ${patientId}`
      );
    } else {
      // Impersonate módban is naplózzuk
      const sessionInfo = await getPatientPortalSessionInfo(request);
      if (sessionInfo?.impersonatedBy) {
        const pool = getDbPool();
        const impersonatorResult = await pool.query(
          `SELECT email FROM users WHERE id = $1`,
          [sessionInfo.impersonatedBy]
        );
        if (impersonatorResult.rows.length > 0) {
          await logActivity(
            request,
            impersonatorResult.rows[0].email,
            'message_sent_impersonated',
            `Üzenet küldve beteg nevében (impersonate): ${patientId}`
          );
        }
      }
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
        const pool = getDbPool();
        let doctor: { email: string; name: string } | null = null;

        // Ha van recipientDoctorId, annak küldjük az értesítést
        if (recipientDoctorIdFinal) {
          const doctorResult = await pool.query(
            `SELECT email, doktor_neve FROM users WHERE id = $1 AND active = true`,
            [recipientDoctorIdFinal]
          );
          if (doctorResult.rows.length > 0) {
            doctor = {
              email: doctorResult.rows[0].email,
              name: doctorResult.rows[0].doktor_neve || doctorResult.rows[0].email,
            };
          }
        } else {
          // Ha nincs recipientDoctorId, akkor a kezelőorvosnak küldjük
          doctor = await getDoctorForNotification(patientId);
        }

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

    // Emit Socket.io event for real-time updates
    try {
      emitNewMessage(patientId, newMessage);
    } catch (socketError) {
      console.error('Hiba a Socket.io event küldésekor:', socketError);
      // Ne akadályozza meg az üzenet küldését, ha a Socket.io nem működik
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

    // Ha beteg kéri (és NEM orvos), csak a saját üzeneteit láthatja
    if (!auth && patientSessionId && patientSessionId !== patientId) {
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

