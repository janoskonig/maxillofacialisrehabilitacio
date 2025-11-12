import { google } from 'googleapis';
import { getDbPool } from './db';
import crypto from 'crypto';

// Google OAuth2 konfiguráció
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Graceful degradation: ha nincs beállítva, null-t adunk vissza
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !ENCRYPTION_KEY) {
  console.warn('Google Calendar credentials not configured. Google Calendar integration will be disabled.');
}

// Encryption key validálása (32 byte = 64 hex karakter)
function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
  // Ha hex string, konvertáljuk buffer-re
  if (ENCRYPTION_KEY.length === 64) {
    return Buffer.from(ENCRYPTION_KEY, 'hex');
  }
  
  // Ha nem hex, használjuk közvetlenül (32 byte kell legyen)
  const key = Buffer.from(ENCRYPTION_KEY, 'utf8');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters or 32 UTF-8 characters)');
  }
  
  return key;
}

/**
 * Token titkosítása AES-256-GCM módszerrel
 */
export function encryptToken(token: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not configured');
  }
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // IV + authTag + encrypted data (hex formátumban)
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Token dekriptálása
 */
export function decryptToken(encryptedToken: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not configured');
  }
  
  const parts = encryptedToken.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * OAuth2 kliens inicializálása
 */
function getOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }
  
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    undefined // Redirect URI dinamikusan lesz beállítva
  );
}

/**
 * Tokenek lekérdezése adatbázisból
 */
async function getTokensFromDb(userId: string): Promise<{
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: Date | null;
} | null> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT 
      google_calendar_refresh_token,
      google_calendar_access_token,
      google_calendar_token_expires_at
    FROM users 
    WHERE id = $1 AND google_calendar_enabled = true`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0];
  
  return {
    refreshToken: row.google_calendar_refresh_token 
      ? decryptToken(row.google_calendar_refresh_token) 
      : null,
    accessToken: row.google_calendar_access_token 
      ? decryptToken(row.google_calendar_access_token) 
      : null,
    expiresAt: row.google_calendar_token_expires_at,
  };
}

/**
 * Access token frissítése ha szükséges
 */
export async function refreshAccessTokenIfNeeded(userId: string): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }
  
  const tokens = await getTokensFromDb(userId);
  if (!tokens || !tokens.refreshToken) {
    return null;
  }
  
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return null;
  }
  
  // Ellenőrizzük, hogy lejárt-e az access token
  const now = new Date();
  const expiresAt = tokens.expiresAt ? new Date(tokens.expiresAt) : null;
  
  // Ha van érvényes access token és még nem járt le (5 perc buffer)
  if (tokens.accessToken && expiresAt && expiresAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    return tokens.accessToken;
  }
  
  // Refresh token használata új access token lekéréséhez
  try {
    oauth2Client.setCredentials({
      refresh_token: tokens.refreshToken,
    });
    
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    if (!credentials.access_token || !credentials.expiry_date) {
      throw new Error('Failed to refresh access token');
    }
    
    // Új tokenek mentése adatbázisba
    const pool = getDbPool();
    await pool.query(
      `UPDATE users 
       SET google_calendar_access_token = $1,
           google_calendar_token_expires_at = $2
       WHERE id = $3`,
      [
        encryptToken(credentials.access_token),
        new Date(credentials.expiry_date),
        userId,
      ]
    );
    
    return credentials.access_token;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    
    // Ha a refresh token invalid, letiltjuk a Google Calendar integrációt
    const pool = getDbPool();
    await pool.query(
      `UPDATE users 
       SET google_calendar_enabled = false,
           google_calendar_access_token = NULL,
           google_calendar_token_expires_at = NULL
       WHERE id = $1`,
      [userId]
    );
    
    return null;
  }
}

/**
 * Google Calendar API kliens inicializálása felhasználóhoz
 */
async function getCalendarClient(userId: string) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }
  
  const accessToken = await refreshAccessTokenIfNeeded(userId);
  if (!accessToken) {
    return null;
  }
  
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return null;
  }
  
  oauth2Client.setCredentials({
    access_token: accessToken,
  });
  
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export interface GoogleCalendarEventData {
  summary: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  calendarId?: string; // Opcionális: ha nincs megadva, 'primary' vagy környezeti változó
}

/**
 * Google Calendar naptárak listázása
 */
export async function listGoogleCalendars(userId: string): Promise<Array<{ id: string; summary: string }>> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('[listGoogleCalendars] Google Calendar credentials not configured');
    return [];
  }
  
  try {
    console.log(`[listGoogleCalendars] Getting calendar client for user ${userId}`);
    const calendar = await getCalendarClient(userId);
    if (!calendar) {
      console.warn(`[listGoogleCalendars] Failed to get calendar client for user ${userId}`);
      return [];
    }
    
    console.log(`[listGoogleCalendars] Fetching calendar list for user ${userId}`);
    const response = await calendar.calendarList.list();
    const calendars = response.data.items || [];
    
    console.log(`[listGoogleCalendars] Found ${calendars.length} calendars for user ${userId}`);
    
    const result = calendars.map((cal) => ({
      id: cal.id || '',
      summary: cal.summary || '',
    }));
    
    return result;
  } catch (error) {
    console.error(`[listGoogleCalendars] Error listing Google Calendars for user ${userId}:`, error);
    if (error instanceof Error) {
      console.error(`[listGoogleCalendars] Error message: ${error.message}`);
      console.error(`[listGoogleCalendars] Error stack: ${error.stack}`);
    }
    return [];
  }
}

/**
 * Google Calendar ID lekérése név alapján
 */
async function getCalendarIdByName(userId: string, calendarName: string): Promise<string | null> {
  if (!calendarName || calendarName === 'primary') {
    return 'primary';
  }
  
  try {
    const calendars = await listGoogleCalendars(userId);
    const found = calendars.find((cal) => 
      cal.summary.toLowerCase() === calendarName.toLowerCase() || 
      cal.id === calendarName
    );
    
    return found ? found.id : null;
  } catch (error) {
    console.error('Error getting calendar ID by name:', error);
    return null;
  }
}

/**
 * Google Calendar esemény létrehozása
 */
export async function createGoogleCalendarEvent(
  userId: string,
  eventData: GoogleCalendarEventData
): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }
  
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) {
      return null;
    }
    
    // Naptár ID meghatározása
    let calendarId = eventData.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    // Ha név alapján van megadva, keresd meg az ID-t
    if (calendarId !== 'primary' && !calendarId.includes('@')) {
      const foundCalendarId = await getCalendarIdByName(userId, calendarId);
      if (foundCalendarId) {
        calendarId = foundCalendarId;
      } else {
        console.warn(`Calendar "${calendarId}" not found, using primary`);
        calendarId = 'primary';
      }
    }
    
    const event = {
      summary: eventData.summary,
      description: eventData.description,
      location: eventData.location || 'Maxillofaciális Rehabilitáció',
      start: {
        dateTime: eventData.startTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: eventData.endTime.toISOString(),
        timeZone: 'UTC',
      },
      status: 'confirmed' as const,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 nappal előtte
          { method: 'popup', minutes: 60 }, // 1 órával előtte
        ],
      },
    };
    
    const response = await calendar.events.insert({
      calendarId: calendarId,
      requestBody: event,
    });
    
    return response.data.id || null;
  } catch (error) {
    console.error('Error creating Google Calendar event:', error);
    return null;
  }
}

/**
 * Google Calendar esemény törlése
 */
export async function deleteGoogleCalendarEvent(
  userId: string,
  eventId: string,
  calendarId?: string
): Promise<boolean> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return false;
  }
  
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) {
      return false;
    }
    
    // Naptár ID meghatározása
    let targetCalendarId = calendarId || 'primary';
    
    // Ha név alapján van megadva, keresd meg az ID-t
    if (targetCalendarId !== 'primary' && !targetCalendarId.includes('@')) {
      const foundCalendarId = await getCalendarIdByName(userId, targetCalendarId);
      if (foundCalendarId) {
        targetCalendarId = foundCalendarId;
      } else {
        console.warn(`Calendar "${targetCalendarId}" not found, using primary`);
        targetCalendarId = 'primary';
      }
    }
    
    await calendar.events.delete({
      calendarId: targetCalendarId,
      eventId: eventId,
    });
    
    return true;
  } catch (error) {
    console.error('Error deleting Google Calendar event:', error);
    return false;
  }
}

/**
 * Google Calendar esemény frissítése
 */
export async function updateGoogleCalendarEvent(
  userId: string,
  eventId: string,
  eventData: GoogleCalendarEventData,
  originalCalendarId?: string
): Promise<boolean> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return false;
  }
  
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) {
      return false;
    }
    
    // Naptár ID meghatározása
    let calendarId = originalCalendarId || eventData.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    // Ha név alapján van megadva, keresd meg az ID-t
    if (calendarId !== 'primary' && !calendarId.includes('@')) {
      const foundCalendarId = await getCalendarIdByName(userId, calendarId);
      if (foundCalendarId) {
        calendarId = foundCalendarId;
      } else {
        console.warn(`Calendar "${calendarId}" not found, using primary`);
        calendarId = 'primary';
      }
    }
    
    // Először lekérjük a meglévő eseményt
    const existingEvent = await calendar.events.get({
      calendarId: calendarId,
      eventId: eventId,
    });
    
    if (!existingEvent.data) {
      return false;
    }
    
    // Frissítjük az eseményt
    const updatedEvent = {
      ...existingEvent.data,
      summary: eventData.summary,
      description: eventData.description,
      location: eventData.location || 'Maxillofaciális Rehabilitáció',
      start: {
        dateTime: eventData.startTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: eventData.endTime.toISOString(),
        timeZone: 'UTC',
      },
    };
    
    await calendar.events.update({
      calendarId: calendarId,
      eventId: eventId,
      requestBody: updatedEvent,
    });
    
    return true;
  } catch (error) {
    console.error('Error updating Google Calendar event:', error);
    return false;
  }
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

/**
 * Google Calendar események lekérdezése egy időintervallumra
 */
export async function fetchGoogleCalendarEvents(
  userId: string,
  timeMin: Date,
  timeMax: Date,
  calendarId?: string
): Promise<GoogleCalendarEvent[]> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return [];
  }
  
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) {
      return [];
    }
    
    // Naptár ID meghatározása
    let sourceCalendarId = calendarId || 'primary';
    
    // Ha név alapján van megadva, keresd meg az ID-t
    if (sourceCalendarId !== 'primary' && !sourceCalendarId.includes('@')) {
      const foundCalendarId = await getCalendarIdByName(userId, sourceCalendarId);
      if (foundCalendarId) {
        sourceCalendarId = foundCalendarId;
      } else {
        console.warn(`Source calendar "${sourceCalendarId}" not found, using primary`);
        sourceCalendarId = 'primary';
      }
    }
    
    // Pagination kezelése - a Google Calendar API max 2500 eseményt ad vissza egy kérésben
    let allEvents: any[] = [];
    let pageToken: string | undefined = undefined;
    
    do {
      const response: any = await calendar.events.list({
        calendarId: sourceCalendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500, // Max eredmények száma per oldal
        pageToken: pageToken,
      });
      
      const items = response.data.items || [];
      allEvents = allEvents.concat(items);
      
      pageToken = response.data.nextPageToken || undefined;
      
      if (pageToken) {
        console.log(`[fetchGoogleCalendarEvents] Fetched ${allEvents.length} events so far, more pages available...`);
      }
    } while (pageToken);
    
    console.log(`[fetchGoogleCalendarEvents] Total events fetched: ${allEvents.length}`);
    
    return allEvents.map((event) => ({
      id: event.id || '',
      summary: event.summary || '',
      start: event.start || { dateTime: '', date: '' },
      end: event.end || { dateTime: '', date: '' },
    }));
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error);
    return [];
  }
}

/**
 * Szinkronizálja a Google Calendar "szabad" eseményeit szabad időpontokként
 */
export async function syncTimeSlotsFromGoogleCalendar(userId: string): Promise<{
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}> {
  const result = {
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [] as string[],
  };
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return result;
  }
  
  try {
    const pool = getDbPool();
    
    // Ellenőrizzük, hogy a felhasználó Google Calendar-hoz kapcsolva van-e
    const userResult = await pool.query(
      `SELECT id, email, google_calendar_source_calendar_id 
       FROM users 
       WHERE id = $1 AND google_calendar_enabled = true`,
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return result;
    }
    
    const user = userResult.rows[0];
    const sourceCalendarId = user.google_calendar_source_calendar_id || 'primary';
    
    // Lekérjük a jövőbeli eseményeket (2 év előre, hogy a jövő évi eseményeket is megtalálja)
    const now = new Date();
    const timeMax = new Date(now);
    timeMax.setFullYear(timeMax.getFullYear() + 2);
    
    const events = await fetchGoogleCalendarEvents(userId, now, timeMax, sourceCalendarId);
    console.log(`[syncTimeSlotsFromGoogleCalendar] Found ${events.length} total events from ${now.toISOString()} to ${timeMax.toISOString()}`);
    
    // Keresjük a "szabad" vagy "szabad X" formátumú eseményeket
    // Regex: szabad\s+(\d+) - "szabad" szó után opcionális szóköz(ök) és szám
    const szabadPattern = /^szabad\s+(\d+)$/i;
    const szabadEvents = events.filter((event) => {
      const summary = event.summary || '';
      return summary.toLowerCase() === 'szabad' || szabadPattern.test(summary);
    });
    console.log(`[syncTimeSlotsFromGoogleCalendar] Found ${szabadEvents.length} "szabad" events`);
    
    // Lekérjük az adatbázisban lévő Google Calendar-ból származó időpontokat
    const existingSlotsResult = await pool.query(
      `SELECT id, google_calendar_event_id, start_time, status, teremszam 
       FROM available_time_slots 
       WHERE user_id = $1 AND source = 'google_calendar' AND google_calendar_event_id IS NOT NULL`,
      [userId]
    );
    
    const existingSlots = new Map<string, {
      id: string;
      startTime: Date;
      status: string;
      teremszam: string | null;
    }>();
    
    existingSlotsResult.rows.forEach((row) => {
      if (row.google_calendar_event_id) {
        existingSlots.set(row.google_calendar_event_id, {
          id: row.id,
          startTime: new Date(row.start_time),
          status: row.status,
          teremszam: row.teremszam,
        });
      }
    });
    
    // Feldolgozzuk a Google Calendar eseményeket
    const processedEventIds = new Set<string>();
    
    for (const event of szabadEvents) {
      processedEventIds.add(event.id);
      
      // Parse start time
      const startTimeStr = event.start.dateTime || event.start.date;
      if (!startTimeStr) {
        result.errors.push(`Event ${event.id} has no start time`);
        continue;
      }
      
      const startTime = new Date(startTimeStr);
      if (isNaN(startTime.getTime())) {
        result.errors.push(`Event ${event.id} has invalid start time: ${startTimeStr}`);
        continue;
      }
      
      // Csak jövőbeli eseményeket kezelünk
      if (startTime < now) {
        continue;
      }
      
      // Kinyerjük a teremszámot a "szabad X" formátumból
      let teremszam: string | null = null;
      const summary = event.summary || '';
      const match = summary.match(/^szabad\s+(\d+)$/i);
      if (match && match[1]) {
        teremszam = match[1];
      }
      
      const existingSlot = existingSlots.get(event.id);
      
      if (existingSlot) {
        // Ha van már ilyen időpont, ellenőrizzük, hogy változott-e
        const startTimeChanged = existingSlot.startTime.getTime() !== startTime.getTime();
        const teremszamChanged = existingSlot.teremszam !== teremszam;
        
        if (startTimeChanged || teremszamChanged) {
          // Csak akkor frissítünk, ha nincs lefoglalva
          if (existingSlot.status === 'available') {
            const updates: string[] = [];
            const values: any[] = [];
            let paramIndex = 1;
            
            if (startTimeChanged) {
              updates.push(`start_time = $${paramIndex}`);
              values.push(startTime.toISOString());
              paramIndex++;
            }
            
            if (teremszamChanged) {
              updates.push(`teremszam = $${paramIndex}`);
              values.push(teremszam);
              paramIndex++;
            }
            
            if (updates.length > 0) {
              values.push(existingSlot.id);
              await pool.query(
                `UPDATE available_time_slots 
                 SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $${paramIndex}`,
                values
              );
              result.updated++;
            }
          }
        }
      } else {
        // Új időpont létrehozása
        // cim-et nem állítjuk be (marad NULL, majd az API alapértelmezett értéket használ)
        await pool.query(
          `INSERT INTO available_time_slots (user_id, start_time, status, google_calendar_event_id, source, teremszam)
           VALUES ($1, $2, 'available', $3, 'google_calendar', $4)`,
          [userId, startTime.toISOString(), event.id, teremszam]
        );
        result.created++;
      }
    }
    
    // Töröljük azokat az időpontokat, amelyek már nincsenek a Google Calendar-ban
    for (const [eventId, slot] of Array.from(existingSlots.entries())) {
      if (!processedEventIds.has(eventId)) {
        // Csak akkor törölünk, ha nincs lefoglalva
        if (slot.status === 'available') {
          await pool.query(
            `DELETE FROM available_time_slots WHERE id = $1`,
            [slot.id]
          );
          result.deleted++;
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error syncing time slots from Google Calendar:', error);
    result.errors.push(`Sync error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return result;
  }
}

