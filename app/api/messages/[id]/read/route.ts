import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { markMessageAsRead } from '@/lib/communication';
import { getDbPool } from '@/lib/db';

/**
 * PUT /api/messages/[id]/read - Üzenet olvasottnak jelölése
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const messageId = params.id;

    if (!messageId) {
      return NextResponse.json(
        { error: 'Üzenet ID kötelező' },
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
      `SELECT patient_id, sender_type, sender_id FROM messages WHERE id = $1`,
      [messageId]
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
      if (auth.role !== 'admin' && patient.kezeleoorvos !== auth.email) {
        // Ellenőrizzük, hogy a user doktor_neve mezője egyezik-e
        const userResult = await pool.query(
          `SELECT doktor_neve FROM users WHERE id = $1`,
          [auth.userId]
        );
        const userName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : null;
        
        if (patient.kezeleoorvos !== userName) {
          return NextResponse.json(
            { error: 'Nincs jogosultsága az üzenet olvasottnak jelöléséhez' },
            { status: 403 }
          );
        }
      }
    }

    // Üzenet olvasottnak jelölése
    await markMessageAsRead(messageId);

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

