import webpush from 'web-push';
import { getDbPool } from './db';

// VAPID konfiguráció betöltése
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    type: 'appointment' | 'message' | 'reminder';
    id?: string;
  };
  requireInteraction?: boolean;
  vibrate?: number[];
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

/**
 * Push notification küldése egy felhasználónak
 */
export async function sendPushNotification(
  userId: string,
  payload: PushNotificationPayload
): Promise<void> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('[Push] VAPID keys not configured, skipping push notification');
    return;
  }

  const pool = getDbPool();
  
  // Felhasználó összes subscription-jének lekérdezése
  const result = await pool.query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return; // Nincs subscription
  }

  const subscriptions = result.rows;
  console.log(`[Push] Sending notification to ${subscriptions.length} subscription(s) for user ${userId}`);
  
  const pushPromises = subscriptions.map(async (sub: any) => {
    try {
      const subscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      console.log(`[Push] Sending to endpoint: ${sub.endpoint.substring(0, 50)}...`);
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      console.log(`[Push] Notification sent successfully to endpoint: ${sub.endpoint.substring(0, 50)}...`);
    } catch (error: any) {
      // Ha a subscription expired vagy invalid, töröljük
      if (error.statusCode === 410 || error.statusCode === 404) {
        console.log(`[Push] Removing expired subscription for user ${userId}, endpoint: ${sub.endpoint.substring(0, 50)}...`);
        await pool.query(
          'DELETE FROM push_subscriptions WHERE endpoint = $1',
          [sub.endpoint]
        );
      } else {
        console.error(`[Push] Error sending notification to user ${userId}:`, error);
        console.error(`[Push] Error details:`, {
          statusCode: error.statusCode,
          message: error.message,
          body: error.body
        });
      }
    }
  });

  await Promise.allSettled(pushPromises);
}

/**
 * Push notification küldése több felhasználónak
 */
export async function sendPushNotificationToMultiple(
  userIds: string[],
  payload: PushNotificationPayload
): Promise<void> {
  if (userIds.length === 0) return;

  const promises = userIds.map(userId => sendPushNotification(userId, payload));
  await Promise.allSettled(promises);
}

/**
 * Push notification küldése email alapján (user lookup)
 */
export async function sendPushNotificationByEmail(
  email: string,
  payload: PushNotificationPayload
): Promise<void> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    return;
  }

  const pool = getDbPool();
  
  // User ID lekérdezése email alapján
  const userResult = await pool.query(
    'SELECT id FROM users WHERE email = $1 AND active = true',
    [email]
  );

  if (userResult.rows.length === 0) {
    return; // User nem található
  }

  const userId = userResult.rows[0].id;
  await sendPushNotification(userId, payload);
}
