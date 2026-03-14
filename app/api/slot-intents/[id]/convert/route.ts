import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { convertIntentToAppointment } from '@/lib/convert-slot-intent';

/**
 * POST /api/slot-intents/:id/convert — convert soft intent to hard appointment
 * Body: { timeSlotId } — picks a free slot within the window (suggested or window)
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const intentId = params.id;
  const body = await req.json().catch(() => ({}));
  const { timeSlotId } = body;

  const pool = getDbPool();
  const result = await convertIntentToAppointment(pool, intentId, auth, {
    timeSlotId,
    skipOneHardNext: false,
  });

  if (result.ok) {
    return NextResponse.json(
      { appointment: { id: result.appointmentId }, intentId: result.intentId },
      { status: 201 }
    );
  }

  return NextResponse.json(
    {
      error: result.error,
      ...(result.code && { code: result.code }),
      ...(result.overrideHint && { overrideHint: result.overrideHint }),
    },
    { status: result.status }
  );
});
