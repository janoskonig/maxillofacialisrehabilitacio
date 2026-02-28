import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { markDoctorMessageAsRead } from '@/lib/doctor-communication';
import { getDbPool } from '@/lib/db';
import { emitDoctorMessageRead } from '@/lib/socket-server';

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
    `SELECT group_id FROM doctor_messages WHERE id = $1`,
    [id]
  );

  if (messageResult.rows.length > 0 && messageResult.rows[0].group_id) {
    const groupId = messageResult.rows[0].group_id;
    const userResult = await pool.query(
      `SELECT doktor_neve FROM users WHERE id = $1`,
      [auth.userId]
    );
    const userName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : null;
    
    emitDoctorMessageRead(groupId, id, auth.userId, userName);
  }

  return NextResponse.json({
    success: true,
    message: 'Üzenet olvasottnak jelölve',
  });
});
