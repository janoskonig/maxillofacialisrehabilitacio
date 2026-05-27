import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { markDoctorMessageAsRead } from '@/lib/doctor-communication';
import { getDbPool } from '@/lib/db';
import { emitDoctorMessageRead, emitDoctorMessageReadDirect } from '@/lib/socket-server';
import {
  buildDoctorChannelReadDeliveryUpdate,
  notifyDeliveryStatusUpdates,
  notifyGroupMessageFullyReadIfNeeded,
} from '@/lib/message-delivery';

export const dynamic = 'force-dynamic';

export const PUT = authedHandler(async (req, { auth, params }) => {
  const { id } = params;

  if (!id) {
    return NextResponse.json(
      { error: 'Üzenet ID kötelező' },
      { status: 400 }
    );
  }

  await markDoctorMessageAsRead(id, auth.userId);

  const pool = getDbPool();
  const messageResult = await pool.query(
    `SELECT group_id, sender_id, recipient_id FROM doctor_messages WHERE id = $1`,
    [id]
  );

  if (messageResult.rows.length > 0) {
    const row = messageResult.rows[0];
    if (row.group_id) {
      const userResult = await pool.query(
        `SELECT doktor_neve FROM users WHERE id = $1`,
        [auth.userId]
      );
      const userName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : null;

      emitDoctorMessageRead(row.group_id, id, auth.userId, userName);
      await notifyGroupMessageFullyReadIfNeeded(id, row.group_id);
    } else if (row.sender_id && row.sender_id !== auth.userId) {
      // Slice 0.7: 1:1 — a feladónak küldjük, hogy az ő UI-jában frissüljön.
      emitDoctorMessageReadDirect({
        senderUserId: row.sender_id,
        recipientUserId: auth.userId,
        messageId: id,
      });
      // Fázis 2: küldő bubble deliveryStatus → read.
      notifyDeliveryStatusUpdates([
        buildDoctorChannelReadDeliveryUpdate({
          id,
          sender_id: row.sender_id,
          group_id: null,
        }),
      ]);
    }
  }

  return NextResponse.json({
    success: true,
    message: 'Üzenet olvasottnak jelölve',
  });
});
