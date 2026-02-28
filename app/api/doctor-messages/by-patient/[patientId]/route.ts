import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { DoctorMessage } from '@/lib/doctor-communication';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doctor-messages/by-patient/[patientId] - Betegre hivatkozó orvos-orvos üzenetek lekérése
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const { patientId } = params;
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
  const role = auth.role;
  const userEmail = auth.email;
  
  if (role === 'technikus') {
    const patientFullResult = await pool.query(
      `SELECT kezelesi_terv_arcot_erinto FROM patients WHERE id = $1`,
      [patientId]
    );
    const hasEpitesis = patientFullResult.rows[0]?.kezelesi_terv_arcot_erinto && 
                        Array.isArray(patientFullResult.rows[0].kezelesi_terv_arcot_erinto) && 
                        patientFullResult.rows[0].kezelesi_terv_arcot_erinto.length > 0;
    if (!hasEpitesis) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
        { status: 403 }
      );
    }
  } else if (role === 'sebészorvos' && userEmail) {
    const userResult = await pool.query(
      `SELECT intezmeny FROM users WHERE email = $1`,
      [userEmail]
    );
    
    if (userResult.rows.length > 0 && userResult.rows[0].intezmeny) {
      const userInstitution = userResult.rows[0].intezmeny;
      const patientFullResult = await pool.query(
        `SELECT beutalo_intezmeny FROM patients WHERE id = $1`,
        [patientId]
      );
      if (patientFullResult.rows[0]?.beutalo_intezmeny !== userInstitution) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
          { status: 403 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
        { status: 403 }
      );
    }
  }

  const result = await pool.query(
    `SELECT 
      dm.id,
      dm.sender_id,
      dm.recipient_id,
      dm.group_id,
      dm.sender_email,
      dm.sender_name,
      dm.subject,
      dm.message,
      dm.read_at,
      dm.created_at,
      dm.mentioned_patient_ids,
      u_sender.doktor_neve as sender_display_name,
      u_recipient.doktor_neve as recipient_display_name,
      u_recipient.email as recipient_email,
      g.name as group_name,
      (SELECT COUNT(*) FROM doctor_message_group_participants WHERE group_id = dm.group_id) as group_participant_count
    FROM doctor_messages dm
    LEFT JOIN users u_sender ON u_sender.id = dm.sender_id
    LEFT JOIN users u_recipient ON u_recipient.id = dm.recipient_id
    LEFT JOIN doctor_message_groups g ON g.id = dm.group_id
    WHERE dm.mentioned_patient_ids IS NOT NULL
      AND dm.mentioned_patient_ids != '[]'::jsonb
      AND EXISTS (
        SELECT 1 
        FROM jsonb_array_elements_text(dm.mentioned_patient_ids) AS elem
        WHERE elem = $1
      )
      AND (
        dm.sender_id = $2 
        OR dm.recipient_id = $2 
        OR dm.group_id IN (
          SELECT group_id 
          FROM doctor_message_group_participants 
          WHERE user_id = $2
        )
      )
    ORDER BY dm.created_at DESC`,
    [patientId, auth.userId]
  );

  const messages: DoctorMessage[] = result.rows.map((row: any) => ({
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    groupId: row.group_id || undefined,
    senderEmail: row.sender_email,
    senderName: row.sender_display_name || row.sender_name,
    recipientName: row.recipient_display_name || row.recipient_email || null,
    groupName: row.group_name || null,
    groupParticipantCount: row.group_participant_count ? parseInt(row.group_participant_count, 10) : undefined,
    subject: row.subject,
    message: row.message,
    readAt: row.read_at ? new Date(row.read_at) : null,
    createdAt: new Date(row.created_at),
  }));

  return NextResponse.json({
    success: true,
    messages,
  });
});
