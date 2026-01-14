import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { markMessageAsRead } from '@/lib/communication';
import { getDbPool } from '@/lib/db';
import { validateUUID } from '@/lib/validation';

/**
 * PUT /api/messages/[id]/read - Üzenet olvasottnak jelölése
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const messageId = params.id;

    // Validáció
    let validatedMessageId: string;
    try {
      validatedMessageId = validateUUID(messageId, 'Üzenet ID');
    } catch (validationError: any) {
      return NextResponse.json(
        { error: validationError.message || 'Érvénytelen üzenet ID' },
        { status: 400 }
      );
    }

    // Ellenőrizzük a jogosultságot
    const auth = await verifyAuth(request);
    const patientSessionId = await verifyPatientPortalSession(request);

    if (!auth && !patientSessionId) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenet olvasottnak jelöléséhez' },
        { status: 401 }
      );
    }

    // Ellenőrizzük, hogy a felhasználó hozzáférhet-e az üzenethez
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

    // Ha beteg jelöli olvasottnak, csak a saját üzeneteit jelölheti
    if (patientSessionId) {
      if (message.patient_id !== patientSessionId) {
        return NextResponse.json(
          { error: 'Csak saját üzeneteit jelölheti olvasottnak' },
          { status: 403 }
        );
      }
    }

    // Ha orvos jelöli olvasottnak, ellenőrizzük a hozzáférést
    if (auth) {
      // Admin minden üzenetet jelölhet olvasottnak
      if (auth.role === 'admin') {
        // Admin hozzáfér minden üzenethez, nincs további ellenőrzés
      } else {
        // Nem admin: ellenőrizzük a hozzáférést
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
        
        // Ellenőrizzük, hogy a kezelőorvos-e
        const userResult = await pool.query(
          `SELECT doktor_neve FROM users WHERE id = $1`,
          [auth.userId]
        );
        const userName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : null;
        const isTreatingDoctor = patient.kezeleoorvos === auth.email || patient.kezeleoorvos === userName;
        
        let hasAccess = false;
        
        if (message.sender_type === 'patient') {
          // Beteg küldte az üzenetet
          if (isTreatingDoctor) {
            // Kezelőorvos: hozzáfér az összes betegtől érkező üzenethez
            // (recipient_doctor_id IS NULL = kezelőorvosnak küldve, vagy explicit neki küldve)
            hasAccess = !message.recipient_doctor_id || message.recipient_doctor_id === auth.userId;
          } else {
            // Nem kezelőorvos: csak az explicit neki küldött üzenetekhez fér hozzá
            // (recipient_doctor_id nem lehet NULL, mert akkor a kezelőorvosnak küldték)
            hasAccess = message.recipient_doctor_id === auth.userId;
          }
        } else if (message.sender_type === 'doctor') {
          // Orvos küldte az üzenetet - csak akkor fér hozzá, ha ő küldte
          // (az orvos mindig jelölheti olvasottnak a saját üzeneteit)
          hasAccess = message.sender_id === auth.userId;
        }
        
        if (!hasAccess) {
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

    // Üzenet olvasottnak jelölése
    await markMessageAsRead(validatedMessageId);

    return NextResponse.json({
      success: true,
      message: 'Üzenet olvasottnak jelölve',
    });
  } catch (error: any) {
    console.error('Hiba az üzenet olvasottnak jelölésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenet olvasottnak jelölésekor' },
      { status: 500 }
    );
  }
}

