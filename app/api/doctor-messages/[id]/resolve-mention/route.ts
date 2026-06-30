import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { resolvePatientMention } from '@/lib/doctor-communication';
import { emitDoctorMessageMentionResolved } from '@/lib/socket-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/doctor-messages/[id]/resolve-mention
 *
 * Egy feloldatlan, kétértelmű beteg-említés feloldása az elküldött üzeneten: a
 * `matchedText` szövegrészhez a `patientId` beteget köti hozzá. A szál bármely
 * résztvevője hívhatja (ACL a `resolvePatientMention`-ben). Sikeres feloldás
 * után realtime frissítést szórunk a beszélgetés résztvevőinek.
 *
 * Body: { matchedText: string, patientId: string }
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: 'Üzenet ID kötelező' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const matchedText = typeof body?.matchedText === 'string' ? body.matchedText : '';
  const patientId = typeof body?.patientId === 'string' ? body.patientId : '';

  if (!matchedText || !patientId) {
    return NextResponse.json(
      { error: 'matchedText és patientId megadása kötelező' },
      { status: 400 },
    );
  }

  const result = await resolvePatientMention({
    messageId: id,
    matchedText,
    patientId,
    userId: auth.userId,
  });

  // Realtime frissítés a szál résztvevőinek (a feladónak és a címzettnek is).
  try {
    const recipientUserIds = result.groupId
      ? []
      : Array.from(
          new Set(
            [result.senderId, result.recipientId].filter(
              (uid): uid is string => typeof uid === 'string' && uid.length > 0,
            ),
          ),
        );
    emitDoctorMessageMentionResolved({
      messageId: id,
      groupId: result.groupId,
      recipientUserIds,
      mentionedPatients: result.mentionedPatients,
      unresolvedMentions: result.unresolvedMentions,
    });
  } catch (socketError) {
    logger.error('Hiba a Socket.io mention-resolved emit során:', socketError);
  }

  return NextResponse.json({
    success: true,
    messageId: id,
    mentionedPatientIds: result.mentionedPatientIds,
    mentionedPatients: result.mentionedPatients,
    unresolvedMentions: result.unresolvedMentions,
  });
});
