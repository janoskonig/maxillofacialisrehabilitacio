import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { DoctorMessage } from '@/lib/doctor-communication';

/**
 * GET /api/doctor-messages/by-patient/[patientId] - Betegre hivatkozó orvos-orvos üzenetek lekérése
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { patientId: string } }
) {
  try {
    const { patientId } = params;

    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Verify that the user has access to this patient
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
    
    // Check access: admin can see all, others only their own patients
    if (auth.role !== 'admin') {
      // Check if patient's kezeleoorvos matches user's email or doktor_neve
      const userResult = await pool.query(
        `SELECT email, doktor_neve FROM users WHERE id = $1`,
        [auth.userId]
      );
      
      if (userResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Felhasználó nem található' },
          { status: 404 }
        );
      }

      const user = userResult.rows[0];
      const kezeleoorvos = patient.kezeleoorvos;
      
      if (kezeleoorvos !== user.email && kezeleoorvos !== user.doktor_neve) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
          { status: 403 }
        );
      }
    }

    // Get doctor messages that mention this patient
    const result = await pool.query(
      `SELECT 
        dm.id,
        dm.sender_id,
        dm.recipient_id,
        dm.sender_email,
        dm.sender_name,
        dm.subject,
        dm.message,
        dm.read_at,
        dm.created_at,
        u_sender.doktor_neve as sender_display_name,
        u_recipient.doktor_neve as recipient_display_name
      FROM doctor_messages dm
      LEFT JOIN users u_sender ON u_sender.id = dm.sender_id
      LEFT JOIN users u_recipient ON u_recipient.id = dm.recipient_id
      WHERE dm.mentioned_patient_ids @> $1::jsonb
      ORDER BY dm.created_at DESC`,
      [JSON.stringify([patientId])]
    );

    const messages: DoctorMessage[] = result.rows.map((row: any) => ({
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      senderEmail: row.sender_email,
      senderName: row.sender_display_name || row.sender_name,
      subject: row.subject,
      message: row.message,
      readAt: row.read_at ? new Date(row.read_at) : null,
      createdAt: new Date(row.created_at),
    }));

    return NextResponse.json({
      success: true,
      messages,
    });
  } catch (error: any) {
    console.error('Hiba a betegre hivatkozó üzenetek lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenetek lekérésekor' },
      { status: 500 }
    );
  }
}

