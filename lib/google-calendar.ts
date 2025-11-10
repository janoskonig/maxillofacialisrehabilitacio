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
      calendarId: 'primary',
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
  eventId: string
): Promise<boolean> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return false;
  }
  
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) {
      return false;
    }
    
    await calendar.events.delete({
      calendarId: 'primary',
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
  eventData: GoogleCalendarEventData
): Promise<boolean> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return false;
  }
  
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) {
      return false;
    }
    
    // Először lekérjük a meglévő eseményt
    const existingEvent = await calendar.events.get({
      calendarId: 'primary',
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
      calendarId: 'primary',
      eventId: eventId,
      requestBody: updatedEvent,
    });
    
    return true;
  } catch (error) {
    console.error('Error updating Google Calendar event:', error);
    return false;
  }
}

