import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession, getPatientPortalSessionInfo } from '@/lib/patient-portal-server';
import { sendMessage, getPatientMessages } from '@/lib/communication';
import { sendNewMessageNotification } from '@/lib/email';
import { getPatientForNotification, getDoctorForNotification } from '@/lib/communication';
import { logActivityWithAuth, logActivity } from '@/lib/activity';
import { getDbPool } from '@/lib/db';
import { emitNewMessage } from '@/lib/socket-server';
import { validateUUID, validateMessageText, validateSubject, validateLimit, validateOffset } from '@/lib/validation';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const { patientId, subject, message, recipientDoctorId } = body;

  let finalPatientId: string;
  let finalMessage: string;
  let finalSubject: string | null;
  let finalRecipientDoctorId: string | null;
  
  try {
    finalPatientId = validateUUID(patientId, 'Beteg ID');
    finalMessage = validateMessageText(message);
    finalSubject = validateSubject(subject);
    finalRecipientDoctorId = recipientDoctorId ? validateUUID(recipientDoctorId, 'Címzett orvos ID') : null;
  } catch (validationError: any) {
    return NextResponse.json(
      { error: validationError.message || 'Érvénytelen adatok' },
      { status: 400 }
    );
  }

  const auth = await verifyAuth(req);
  const patientSessionId = await verifyPatientPortalSession(req);

  let senderType: 'doctor' | 'patient';
  let senderId: string;
  let senderEmail: string;
  let senderName: string | null = null;
  let recipientDoctorIdFinal: string | null = null;

  if (patientSessionId && patientSessionId === finalPatientId) {
    senderType = 'patient';
    senderId = patientSessionId;
    
    const pool = getDbPool();
    const patientResult = await pool.query(
      `SELECT email, nev FROM patients WHERE id = $1`,
      [finalPatientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    senderEmail = patientResult.rows[0].email || '';
    senderName = patientResult.rows[0].nev;
    
    if (!senderEmail || senderEmail.trim() === '') {
      return NextResponse.json(
        { error: 'A betegnek nincs email címe, ezért nem küldhet üzenetet' },
        { status: 400 }
      );
    }

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

    const adminResult = await pool.query(
      `SELECT id FROM users WHERE role = 'admin' AND active = true LIMIT 1`
    );
    const adminId = adminResult.rows.length > 0 ? adminResult.rows[0].id : null;

    if (finalRecipientDoctorId) {
      if (finalRecipientDoctorId !== treatingDoctorId && finalRecipientDoctorId !== adminId) {
        return NextResponse.json(
          { error: 'Csak a kezelőorvosnak vagy az adminnak küldhet üzenetet' },
          { status: 403 }
        );
      }

      const doctorResult = await pool.query(
        `SELECT id, email, doktor_neve FROM users 
         WHERE id = $1 AND active = true`,
        [finalRecipientDoctorId]
      );

      if (doctorResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'A megadott orvos nem található vagy nem aktív' },
          { status: 404 }
        );
      }

      recipientDoctorIdFinal = finalRecipientDoctorId;
    } else {
      recipientDoctorIdFinal = treatingDoctorId || adminId;
    }
  } else if (auth) {
    senderType = 'doctor';
    senderId = auth.userId;
    senderEmail = auth.email;
    
    const pool = getDbPool();
    const patientResult = await pool.query(
      `SELECT id, kezeleoorvos FROM patients WHERE id = $1`,
      [finalPatientId]
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
          { error: 'Nincs jogosultsága üzenetet küldeni ennek a betegnek' },
          { status: 403 }
        );
      }
    }

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

  const newMessage = await sendMessage({
    patientId: finalPatientId,
    senderType,
    senderId,
    senderEmail,
    subject: finalSubject,
    message: finalMessage,
    recipientDoctorId: recipientDoctorIdFinal,
  });

  if (auth) {
    await logActivityWithAuth(
      req,
      auth,
      'message_sent',
      `Üzenet küldve betegnek: ${patientId}`
    );
  } else {
    const sessionInfo = await getPatientPortalSessionInfo(req);
    if (sessionInfo?.impersonatedBy) {
      const pool = getDbPool();
      const impersonatorResult = await pool.query(
        `SELECT email FROM users WHERE id = $1`,
        [sessionInfo.impersonatedBy]
      );
      if (impersonatorResult.rows.length > 0) {
        await logActivity(
          req,
          impersonatorResult.rows[0].email,
          'message_sent_impersonated',
          `Üzenet küldve beteg nevében (impersonate): ${patientId}`
        );
      }
    }
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
      (req.headers.get('origin') || 'http://localhost:3000');

    if (senderType === 'doctor') {
      const patient = await getPatientForNotification(finalPatientId);
      if (patient && patient.email) {
        await sendNewMessageNotification(
          patient.email,
          patient.nev,
          patient.nem,
          senderName,
          'doctor',
          finalSubject,
          finalMessage,
          baseUrl
        );
        
        try {
          const pool = getDbPool();
          const patientUserResult = await pool.query(
            'SELECT id FROM users WHERE email = $1 AND active = true',
            [patient.email]
          );
          
          if (patientUserResult.rows.length > 0) {
            const patientUserId = patientUserResult.rows[0].id;
            await sendPushNotification(patientUserId, {
              title: "Új üzenet",
              body: `${senderName || 'Orvos'}: ${finalSubject || finalMessage.substring(0, 50)}${finalMessage.length > 50 ? '...' : ''}`,
              icon: "/icon-192x192.png",
              tag: `message-${newMessage.id}`,
              data: {
                url: `/patient-portal/messages`,
                type: "message",
                id: newMessage.id,
              },
            });
          }
        } catch (pushError) {
          logger.error('Failed to send push notification to patient:', pushError);
        }
      }
    } else {
      const pool = getDbPool();
      let doctor: { email: string; name: string } | null = null;

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
        doctor = await getDoctorForNotification(finalPatientId);
      }

      if (doctor) {
        const patient = await getPatientForNotification(finalPatientId);
        logger.info(`[Messages] Email értesítés küldése orvosnak: ${doctor.email}`);
        await sendNewMessageNotification(
          doctor.email,
          doctor.name,
          null,
          patient?.nev || senderName,
          'patient',
          finalSubject,
          finalMessage,
          baseUrl
        );
        logger.info(`[Messages] Email értesítés sikeresen elküldve orvosnak: ${doctor.email}`);
        
        try {
          if (recipientDoctorIdFinal) {
            await sendPushNotification(recipientDoctorIdFinal, {
              title: "Új üzenet",
              body: `${patient?.nev || senderName || 'Beteg'}: ${finalSubject || finalMessage.substring(0, 50)}${finalMessage.length > 50 ? '...' : ''}`,
              icon: "/icon-192x192.png",
              tag: `message-${newMessage.id}`,
              data: {
                url: `/messages?patientId=${finalPatientId}`,
                type: "message",
                id: newMessage.id,
              },
            });
          }
        } catch (pushError) {
          logger.error('Failed to send push notification to doctor:', pushError);
        }
      } else {
        const adminResult = await pool.query(
          `SELECT email, doktor_neve FROM users WHERE role = 'admin' AND active = true`
        );
        
        if (adminResult.rows.length > 0) {
          const patient = await getPatientForNotification(finalPatientId);
          const admin = adminResult.rows[0];
          logger.info(`[Messages] Beteg üzenet - kezelőorvos nem található, adminnak küldve: ${admin.email}`);
          await sendNewMessageNotification(
            admin.email,
            admin.doktor_neve || admin.email,
            null,
            patient?.nev || senderName,
            'patient',
            finalSubject,
            finalMessage,
            baseUrl
          );
          logger.info(`[Messages] Email értesítés sikeresen elküldve adminnak: ${admin.email}`);
        } else {
          console.warn(`[Messages] Beteg üzenet - kezelőorvos és admin sem található beteghez: ${finalPatientId}`);
        }
      }
    }
  } catch (emailError) {
    logger.error('Hiba az email értesítés küldésekor:', emailError);
  }

  try {
    emitNewMessage(finalPatientId, newMessage);
  } catch (socketError) {
    logger.error('Hiba a Socket.io event küldésekor:', socketError);
  }

  return NextResponse.json({
    success: true,
    message: newMessage,
  });
});

export const GET = apiHandler(async (req) => {
  const searchParams = req.nextUrl.searchParams;
  const patientId = searchParams.get('patientId');
  const unreadOnly = searchParams.get('unreadOnly') === 'true';
  
  let validatedPatientId: string;
  let validatedLimit: number | undefined;
  let validatedOffset: number | undefined;
  
  try {
    validatedPatientId = validateUUID(patientId, 'Beteg ID');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    validatedLimit = validateLimit(limitParam ? parseInt(limitParam, 10) : undefined);
    validatedOffset = validateOffset(offsetParam ? parseInt(offsetParam, 10) : undefined);
  } catch (validationError: any) {
    return NextResponse.json(
      { error: validationError.message || 'Érvénytelen paraméterek' },
      { status: 400 }
    );
  }

  const auth = await verifyAuth(req);
  const patientSessionId = await verifyPatientPortalSession(req);

  if (!auth && !patientSessionId) {
    return NextResponse.json(
      { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
      { status: 401 }
    );
  }

  if (!auth && patientSessionId && patientSessionId !== validatedPatientId) {
    return NextResponse.json(
      { error: 'Csak saját üzeneteit tekintheti meg' },
      { status: 403 }
    );
  }

  if (auth) {
    const pool = getDbPool();
    const patientResult = await pool.query(
      `SELECT id, kezeleoorvos FROM patients WHERE id = $1`,
      [validatedPatientId]
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
          { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
          { status: 403 }
        );
      }
    }
  }

  const isAdmin = auth?.role === 'admin';
  const messages = await getPatientMessages(validatedPatientId, {
    unreadOnly,
    limit: validatedLimit,
    offset: validatedOffset,
    doctorId: auth ? auth.userId : undefined,
    isAdmin: isAdmin,
  });

  return NextResponse.json({
    success: true,
    messages,
  });
});
