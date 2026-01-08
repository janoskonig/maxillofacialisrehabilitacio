import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { sendDoctorMessage, getDoctorMessages, getDoctorConversations } from '@/lib/doctor-communication';
import { sendDoctorMessageNotification } from '@/lib/email';
import { getDoctorForNotification } from '@/lib/doctor-communication';
import { logActivityWithAuth } from '@/lib/activity';
import { getDbPool } from '@/lib/db';

/**
 * POST /api/doctor-messages - Új üzenet küldése orvosnak
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recipientId, subject, message } = body;

    // Validáció
    if (!recipientId || !message || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Címzett orvos ID és üzenet tartalma kötelező' },
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

    // Ellenőrizzük, hogy a címzett létezik és aktív
    const pool = getDbPool();
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

    // Küldő orvos neve
    const senderResult = await pool.query(
      `SELECT doktor_neve FROM users WHERE id = $1`,
      [auth.userId]
    );
    const senderName = senderResult.rows.length > 0 ? senderResult.rows[0].doktor_neve : null;

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
    } catch (emailError) {
      console.error('Hiba az email értesítés küldésekor:', emailError);
      // Ne akadályozza meg az üzenet küldését, ha az email nem sikerül
    }

    return NextResponse.json({
      success: true,
      message: newMessage,
    });
  } catch (error: any) {
    console.error('Hiba az üzenet küldésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenet küldésekor' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/doctor-messages - Üzenetek lekérése
 * Query params:
 * - recipientId: konverzáció egy adott orvossal
 * - sentOnly: csak küldött üzenetek
 * - receivedOnly: csak fogadott üzenetek
 * - unreadOnly: csak olvasatlan üzenetek
 * - conversations: true - konverzációk listája
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const recipientId = searchParams.get('recipientId');
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

    // Konverzációk listája
    if (conversations) {
      const conversationsList = await getDoctorConversations(auth.userId);
      return NextResponse.json({
        success: true,
        conversations: conversationsList,
      });
    }

    // Üzenetek lekérése
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
    console.error('Hiba az üzenetek lekérésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az üzenetek lekérésekor' },
      { status: 500 }
    );
  }
}

