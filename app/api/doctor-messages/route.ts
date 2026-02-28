import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { sendDoctorMessage, getDoctorMessages, getDoctorConversations, getGroupMessages, getGroupParticipants } from '@/lib/doctor-communication';
import { sendDoctorMessageNotification } from '@/lib/email';
import { getDoctorForNotification } from '@/lib/doctor-communication';
import { logActivityWithAuth } from '@/lib/activity';
import { getDbPool } from '@/lib/db';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

/**
 * POST /api/doctor-messages - Új üzenet küldése orvosnak vagy csoportos beszélgetésbe
 * Body params:
 * - recipientId: egy-egy beszélgetéshez (opcionális, ha groupId van)
 * - groupId: csoportos beszélgetéshez (opcionális, ha recipientId van)
 * - subject: opcionális tárgy
 * - message: üzenet tartalma
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recipientId, groupId, subject, message } = body;

    // Validáció
    if (!message || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Üzenet tartalma kötelező' },
        { status: 400 }
      );
    }

    // Either recipientId OR groupId must be provided
    if (!recipientId && !groupId) {
      return NextResponse.json(
        { error: 'Címzett orvos ID vagy csoport ID megadása kötelező' },
        { status: 400 }
      );
    }

    // Ellenőrizzük, hogy ki küldi az üzenetet
    const auth = await verifyAuth(request);

    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága üzenetet küldeni' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const senderResult = await pool.query(
      `SELECT doktor_neve FROM users WHERE id = $1`,
      [auth.userId]
    );
    const senderName = senderResult.rows.length > 0 ? senderResult.rows[0].doktor_neve : null;

    // Group message
    if (groupId) {
      // Verify user is a participant
      const participantResult = await pool.query(
        `SELECT user_id FROM doctor_message_group_participants WHERE group_id = $1 AND user_id = $2`,
        [groupId, auth.userId]
      );

      if (participantResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága üzenetet küldeni ehhez a csoporthoz' },
          { status: 403 }
        );
      }

      // Send message to group
      const newMessage = await sendDoctorMessage({
        recipientId: undefined,
        senderId: auth.userId,
        senderEmail: auth.email,
        senderName,
        subject: subject || null,
        message: message.trim(),
        groupId,
      });

      // Get all participants for email notifications
      const participants = await getGroupParticipants(groupId);
      
      // Send email notifications to all participants except sender
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
          (request.headers.get('origin') || 'http://localhost:3000');

        for (const participant of participants) {
          if (participant.userId !== auth.userId) {
            try {
              await sendDoctorMessageNotification(
                participant.userEmail,
                participant.userName,
                senderName || auth.email,
                subject || null,
                message.trim(),
                baseUrl
              );
              
              // Push notification to participant
              try {
                await sendPushNotification(participant.userId, {
                  title: "Új üzenet (csoport)",
                  body: `${senderName || auth.email}: ${subject || message.trim().substring(0, 50)}${message.trim().length > 50 ? '...' : ''}`,
                  icon: "/icon-192x192.png",
                  tag: `doctor-message-group-${groupId}-${newMessage.id}`,
                  data: {
                    url: `/messages?groupId=${groupId}`,
                    type: "message",
                    id: newMessage.id,
                  },
                });
              } catch (pushError) {
                logger.error(`Failed to send push notification to participant ${participant.userId}:`, pushError);
              }
            } catch (emailError) {
              logger.error(`Hiba az email értesítés küldésekor ${participant.userEmail}-nak:`, emailError);
            }
          }
        }
      } catch (emailError) {
        logger.error('Hiba az email értesítések küldésekor:', emailError);
      }

      // Activity log
      await logActivityWithAuth(
        request,
        auth,
        'doctor_group_message_sent',
        `Üzenet küldve csoportos beszélgetésbe`
      );

      return NextResponse.json({
        success: true,
        message: newMessage,
      });
    }

    // Individual message (existing logic)
    if (!recipientId) {
      return NextResponse.json(
        { error: 'Címzett orvos ID megadása kötelező egy-egy beszélgetéshez' },
        { status: 400 }
      );
    }

    // Ellenőrizzük, hogy a címzett létezik és aktív
    const recipientResult = await pool.query(
      `SELECT id, email, doktor_neve, active FROM users WHERE id = $1`,
      [recipientId]
    );

    if (recipientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Címzett orvos nem található' },
        { status: 404 }
      );
    }

    if (!recipientResult.rows[0].active) {
      return NextResponse.json(
        { error: 'Címzett orvos nem aktív' },
        { status: 403 }
      );
    }

    // Nem küldhetünk üzenetet saját magunknak
    if (auth.userId === recipientId) {
      return NextResponse.json(
        { error: 'Nem küldhet üzenetet saját magának' },
        { status: 400 }
      );
    }

    // Üzenet küldése
    const newMessage = await sendDoctorMessage({
      recipientId,
      senderId: auth.userId,
      senderEmail: auth.email,
      senderName,
      subject: subject || null,
      message: message.trim(),
    });

    // Activity log
    await logActivityWithAuth(
      request,
      auth,
      'doctor_message_sent',
      `Üzenet küldve orvosnak: ${recipientResult.rows[0].doktor_neve || recipientResult.rows[0].email}`
    );

    // Email értesítés küldése
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
        (request.headers.get('origin') || 'http://localhost:3000');

      const recipient = recipientResult.rows[0];
      await sendDoctorMessageNotification(
        recipient.email,
        recipient.doktor_neve || recipient.email,
        senderName || auth.email,
        subject || null,
        message.trim(),
        baseUrl
      );
      
      // Push notification to recipient
      try {
        await sendPushNotification(recipientId, {
          title: "Új üzenet",
          body: `${senderName || auth.email}: ${subject || message.trim().substring(0, 50)}${message.trim().length > 50 ? '...' : ''}`,
          icon: "/icon-192x192.png",
          tag: `doctor-message-${newMessage.id}`,
          data: {
            url: `/messages?recipientId=${recipientId}`,
            type: "message",
            id: newMessage.id,
          },
        });
      } catch (pushError) {
        logger.error('Failed to send push notification to recipient:', pushError);
      }
    } catch (emailError) {
      logger.error('Hiba az email értesítés küldésekor:', emailError);
      // Ne akadályozza meg az üzenet küldését, ha az email nem sikerül
    }

    return NextResponse.json({
      success: true,
      message: newMessage,
    });
  } catch (error: any) {
    logger.error('Hiba az üzenet küldésekor:', error);
    return NextResponse.json(
      { error: error.message || 'Hiba történt az üzenet küldésekor' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/doctor-messages - Üzenetek lekérése
 * Query params:
 * - recipientId: konverzáció egy adott orvossal (egy-egy beszélgetés)
 * - groupId: csoportos beszélgetés üzenetei
 * - sentOnly: csak küldött üzenetek
 * - receivedOnly: csak fogadott üzenetek
 * - unreadOnly: csak olvasatlan üzenetek
 * - conversations: true - konverzációk listája (egyesített: egyéni + csoportos)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const recipientId = searchParams.get('recipientId');
    const groupId = searchParams.get('groupId');
    const sentOnly = searchParams.get('sentOnly') === 'true';
    const receivedOnly = searchParams.get('receivedOnly') === 'true';
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const conversations = searchParams.get('conversations') === 'true';
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined;

    // Ellenőrizzük a jogosultságot
    const auth = await verifyAuth(request);

    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az üzenetek megtekintéséhez' },
        { status: 401 }
      );
    }

    // Konverzációk listája (egyesített: egyéni + csoportos)
    if (conversations) {
      const conversationsList = await getDoctorConversations(auth.userId);
      return NextResponse.json({
        success: true,
        conversations: conversationsList,
      });
    }

    // Group messages
    if (groupId) {
      const messages = await getGroupMessages(groupId, auth.userId, {
        limit,
        offset,
      });

      return NextResponse.json({
        success: true,
        messages,
      });
    }

    // Individual messages (existing logic)
    const messages = await getDoctorMessages(auth.userId, {
      recipientId: recipientId || undefined,
      sentOnly,
      receivedOnly,
      unreadOnly,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      messages,
    });
  } catch (error: any) {
    logger.error('Hiba az üzenetek lekérésekor:', error);
    return NextResponse.json(
      { error: error.message || 'Hiba történt az üzenetek lekérésekor' },
      { status: 500 }
    );
  }
}

