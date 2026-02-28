import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { markMessageAsRead } from '@/lib/communication';
import { getDbPool } from '@/lib/db';
import { validateUUID } from '@/lib/validation';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const PUT = apiHandler(async (req, { params }) => {
  const { id } = params;

  let validatedMessageId: string;
  try {
    validatedMessageId = validateUUID(id, 'Üzenet ID');
  } catch (validationError: any) {
    return NextResponse.json(
      { error: validationError.message || 'Érvénytelen üzenet ID' },
      { status: 400 }
    );
  }

  const auth = await verifyAuth(req);
  const patientSessionId = await verifyPatientPortalSession(req);

  logger.info(`[markMessageAsRead API] Request:`, {
    messageId: validatedMessageId,
    hasAuth: !!auth,
    authUserId: auth?.userId,
    authEmail: auth?.email,
    authRole: auth?.role,
    hasPatientSession: !!patientSessionId,
    patientSessionId,
  });

  if (!auth && !patientSessionId) {
    return NextResponse.json(
      { error: 'Nincs jogosultsága az üzenet olvasottnak jelöléséhez' },
      { status: 401 }
    );
  }

  const pool = getDbPool();
  const messageResult = await pool.query(
    `SELECT patient_id, sender_type, sender_id, recipient_doctor_id FROM messages WHERE id = $1`,
    [validatedMessageId]
  );

  if (messageResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Üzenet nem található' },
      { status: 404 }
    );
  }

  const message = messageResult.rows[0];

  logger.info(`[markMessageAsRead API] Message:`, {
    messageId: validatedMessageId,
    patientId: message.patient_id,
    senderType: message.sender_type,
    senderId: message.sender_id,
    recipientDoctorId: message.recipient_doctor_id,
  });

  if (patientSessionId && !auth) {
    logger.info(`[markMessageAsRead API] Beteg portál - checking access`);
    if (message.patient_id !== patientSessionId) {
      console.warn(`[markMessageAsRead API] Beteg portál - patient ID mismatch`);
      return NextResponse.json(
        { error: 'Csak saját üzeneteit jelölheti olvasottnak' },
        { status: 403 }
      );
    }
    if (message.sender_type !== 'doctor') {
      console.warn(`[markMessageAsRead API] Beteg portál - sender type is not doctor`);
      return NextResponse.json(
        { error: 'Csak az orvostól érkező üzeneteket jelölheti olvasottnak' },
        { status: 403 }
      );
    }
    logger.info(`[markMessageAsRead API] Beteg portál - marking as read`);
    await markMessageAsRead(validatedMessageId);
    return NextResponse.json({
      success: true,
      message: 'Üzenet olvasottnak jelölve',
    });
  }

  if (auth) {
    logger.info(`[markMessageAsRead API] Orvos - checking access, role: ${auth.role}`);
    if (auth.role === 'admin') {
      logger.info(`[markMessageAsRead API] Admin - allowing access`);
    } else {
      logger.info(`[markMessageAsRead API] Non-admin doctor - checking access`);
      const patientResult = await pool.query(
        `SELECT id, kezeleoorvos FROM patients WHERE id = $1`,
        [message.patient_id]
      );

      if (patientResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Beteg nem található' },
          { status: 404 }
        );
      }

      const patient = patientResult.rows[0];
      
      const userResult = await pool.query(
        `SELECT doktor_neve FROM users WHERE id = $1`,
        [auth.userId]
      );
      const userName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : null;
      const isTreatingDoctor = patient.kezeleoorvos === auth.email || patient.kezeleoorvos === userName;
      
      let hasAccess = false;
      
      if (message.sender_type === 'patient') {
        if (isTreatingDoctor) {
          hasAccess = !message.recipient_doctor_id || message.recipient_doctor_id === auth.userId;
          logger.info(`[markMessageAsRead API] Treating doctor - hasAccess: ${hasAccess}, recipientDoctorId: ${message.recipient_doctor_id}, doctorId: ${auth.userId}`);
        } else {
          hasAccess = message.recipient_doctor_id === auth.userId;
          logger.info(`[markMessageAsRead API] Non-treating doctor - hasAccess: ${hasAccess}, recipientDoctorId: ${message.recipient_doctor_id}, doctorId: ${auth.userId}`);
        }
      } else if (message.sender_type === 'doctor') {
        hasAccess = message.sender_id === auth.userId;
        logger.info(`[markMessageAsRead API] Doctor message - hasAccess: ${hasAccess}, senderId: ${message.sender_id}, doctorId: ${auth.userId}`);
      }
      
      if (!hasAccess) {
        console.warn(`[markMessageAsRead API] Access denied for doctor`);
        console.warn(`[markMessageAsRead] Hozzáférés megtagadva:`, {
          messageId: validatedMessageId,
          doctorId: auth.userId,
          doctorEmail: auth.email,
          doctorName: userName,
          senderType: message.sender_type,
          senderId: message.sender_id,
          recipientDoctorId: message.recipient_doctor_id,
          isTreatingDoctor,
          patientKezeleoorvos: patient.kezeleoorvos,
          patientId: message.patient_id,
        });
        return NextResponse.json(
          { error: 'Nincs jogosultsága az üzenet olvasottnak jelöléséhez' },
          { status: 403 }
        );
      }
    }
  }

  await markMessageAsRead(validatedMessageId);

  return NextResponse.json({
    success: true,
    message: 'Üzenet olvasottnak jelölve',
  });
});
