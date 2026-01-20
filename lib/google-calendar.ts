import { google } from 'googleapis';
import { getDbPool } from './db';
import crypto from 'crypto';
import { withRetry } from './retry';
import {
  extractGoogleOAuthError,
  isInvalidGrant,
  isInvalidClient,
  isRetryableTransportOrServer,
  extractHttpStatus,
} from './google-errors';

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

// In-memory cache a token érvényességére (1 perc TTL)
interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number; // timestamp
}

const tokenCache = new Map<string, TokenCacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 1 perc

// Single-flight lock a refresh-ekhez (user_id alapján)
interface RefreshResult {
  accessToken: string;
  expiryDate: number; // ms epoch
  refreshToken?: string; // token rotation esetén
}

const refreshLocks = new Map<string, Promise<RefreshResult>>();

// Expiry leeway (90 másodperc)
const EXPIRY_LEEWAY_MS = 90 * 1000;

/**
 * Exception osztály reconnect szükségesség jelzésére
 */
export class GoogleReconnectRequiredError extends Error {
  constructor(message: string, public details?: Record<string, any>) {
    super(message);
    this.name = 'GoogleReconnectRequiredError';
  }
}

// Cache a naptár ID-khoz (5 perc TTL)
interface CalendarCacheEntry {
  calendars: Array<{ id: string; summary: string }>;
  expiresAt: number;
}

const calendarCache = new Map<string, CalendarCacheEntry>();
const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 perc

/**
 * Tokenek lekérdezése adatbázisból
 */
async function getTokensFromDb(userId: string): Promise<{
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: Date | null;
  status: string | null;
} | null> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT 
      google_calendar_refresh_token,
      google_calendar_access_token,
      google_calendar_token_expires_at,
      google_calendar_status
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
    status: row.google_calendar_status || 'active',
  };
}

/**
 * Expiry check: lejár-e hamarosan a token?
 */
function isExpiredSoon(expiryDateMs: number | null): boolean {
  if (!expiryDateMs) {
    return true;
  }
  return Date.now() + EXPIRY_LEEWAY_MS >= expiryDateMs;
}

/**
 * Token mentése adatbázisba (token rotation támogatással)
 * KRITIKUS: refresh token csak akkor frissítjük, ha új érkezik (ne nullázódjon!)
 */
async function saveTokens(
  userId: string,
  accessToken: string,
  expiryDate: Date,
  refreshToken?: string | null
): Promise<void> {
  const pool = getDbPool();
  
  // Ha van új refresh token, azt is mentjük
  // Ha nincs új refresh token, tartsuk meg a régit (ne nullázódjon!)
  if (refreshToken) {
    await pool.query(
      `UPDATE users 
       SET google_calendar_access_token = $1,
           google_calendar_token_expires_at = $2,
           google_calendar_refresh_token = $3
       WHERE id = $4`,
      [encryptToken(accessToken), expiryDate, encryptToken(refreshToken), userId]
    );
  } else {
    // Csak access token frissítése, refresh token változatlan marad
    await pool.query(
      `UPDATE users 
       SET google_calendar_access_token = $1,
           google_calendar_token_expires_at = $2
       WHERE id = $3`,
      [encryptToken(accessToken), expiryDate, userId]
    );
  }
}

/**
 * Státusz és error code mentése adatbázisba
 */
async function updateConnectionStatus(
  userId: string,
  status: 'active' | 'reconnect_required' | 'broken_config',
  errorCode?: string
): Promise<void> {
  const pool = getDbPool();
  
  if (errorCode) {
    await pool.query(
      `UPDATE users 
       SET google_calendar_status = $1,
           google_calendar_last_error_code = $2,
           google_calendar_last_error_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [status, errorCode, userId]
    );
  } else {
    await pool.query(
      `UPDATE users 
       SET google_calendar_status = $1,
           google_calendar_last_error_code = NULL,
           google_calendar_last_error_at = NULL
       WHERE id = $2`,
      [status, userId]
    );
  }
}

/**
 * Token refresh végrehajtása (belső függvény, retry-val hívjuk)
 */
async function performTokenRefresh(userId: string, refreshToken: string): Promise<RefreshResult> {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    throw new Error('OAuth2 client not configured');
  }

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token || !credentials.expiry_date) {
    throw new Error('Failed to refresh access token: missing credentials');
  }

  const expiryDate = new Date(credentials.expiry_date);
  const expiryDateMs = expiryDate.getTime();

  // Token rotation: ha van új refresh token, azt is mentjük
  // KRITIKUS: csak akkor frissítjük, ha új érkezik (ne nullázódjon!)
  const newRefreshToken = credentials.refresh_token || undefined;

  // Tokenek mentése adatbázisba
  await saveTokens(userId, credentials.access_token, expiryDate, newRefreshToken);

  // Cache frissítése
  tokenCache.set(userId, {
    accessToken: credentials.access_token,
    expiresAt: Math.min(expiryDateMs, Date.now() + CACHE_TTL_MS),
  });

  return {
    accessToken: credentials.access_token,
    expiryDate: expiryDateMs,
    refreshToken: newRefreshToken,
  };
}

/**
 * Access token frissítése ha szükséges (stabil implementáció single-flight lock-kal)
 */
export async function refreshAccessTokenIfNeeded(userId: string): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }

  // Ellenőrizzük a cache-t
  const cached = tokenCache.get(userId);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    // Cache érvényes, visszaadjuk a token-t
    return cached.accessToken;
  }

  // Cache lejárt vagy nincs, lekérdezzük az adatbázisból
  const tokens = await getTokensFromDb(userId);
  if (!tokens || !tokens.refreshToken) {
    tokenCache.delete(userId); // Cache törlése ha nincs token
    return null;
  }

  // Ellenőrizzük, hogy lejárt-e az access token
  const expiresAtMs = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : null;

  // Ha van érvényes access token és még nem járt le (90s leeway)
  if (tokens.accessToken && expiresAtMs && !isExpiredSoon(expiresAtMs)) {
    // Cache-be mentjük
    tokenCache.set(userId, {
      accessToken: tokens.accessToken,
      expiresAt: Math.min(expiresAtMs, now + CACHE_TTL_MS),
    });
    return tokens.accessToken;
  }

  // Single-flight lock: ha van futó refresh ugyanarra a user_id-ra, várjuk meg azt
  const existingLock = refreshLocks.get(userId);
  if (existingLock) {
    try {
      const result = await existingLock;
      return result.accessToken;
    } catch (err) {
      // Ha a lock-ban hiba volt, próbáljuk meg újra (de csak ha nem invalid_grant)
      if (err instanceof GoogleReconnectRequiredError) {
        throw err;
      }
      // Egyéb hibák esetén próbáljuk meg újra (de csak ha már nincs lock)
      // (ez ritka edge case, de biztonság kedvéért)
    }
  }

  // Új refresh indítása single-flight lock-kal
  const refreshPromise = (async (): Promise<RefreshResult> => {
    try {
      const result = await withRetry(
        () => performTokenRefresh(userId, tokens.refreshToken!),
        {
          retries: 3,
          baseDelayMs: 500,
          maxDelayMs: 4000,
          shouldRetry: (err) => {
            // invalid_grant és invalid_client nem retryable
            if (isInvalidGrant(err) || isInvalidClient(err)) {
              return false;
            }
            return isRetryableTransportOrServer(err);
          },
          onRetry: ({ attempt, delayMs, err, retryAfter }) => {
            const ex = extractGoogleOAuthError(err);
            console.warn(
              `[refreshAccessTokenIfNeeded] Retry ${attempt} for user ${userId}`,
              {
                delayMs,
                retryAfter,
                error: ex.error,
                description: ex.description,
              }
            );
          },
        }
      );

      // Sikeres refresh: státusz aktívra állítása
      await updateConnectionStatus(userId, 'active');

      console.log(`[refreshAccessTokenIfNeeded] Token refreshed successfully for user ${userId}`, {
        expiry_date: result.expiryDate,
        rotated: Boolean(result.refreshToken),
      });

      return result;
    } catch (err) {
      const ex = extractGoogleOAuthError(err);
      const status = extractHttpStatus(err);

      // EGYETLEN esetben kérünk re-connectet: invalid_grant
      if (isInvalidGrant(err)) {
        console.warn(
          `[refreshAccessTokenIfNeeded] Invalid refresh token (invalid_grant) for user ${userId}; reconnect required`,
          { error: ex.error, description: ex.description }
        );
        await updateConnectionStatus(userId, 'reconnect_required', 'invalid_grant');
        throw new GoogleReconnectRequiredError(
          'Google authorization expired or revoked; reconnect required.',
          { error: ex.error, description: ex.description }
        );
      }

      // invalid_client: konfigurációs hiba
      if (isInvalidClient(err)) {
        console.error(
          `[refreshAccessTokenIfNeeded] Invalid OAuth client for user ${userId}; configuration issue`,
          { error: ex.error, description: ex.description }
        );
        await updateConnectionStatus(userId, 'broken_config', ex.error || 'invalid_client');
        throw new Error('Google OAuth client misconfiguration.');
      }

      // Minden más: ne bonts kapcsolatot, csak fail (a caller döntsön retry-ról)
      console.error(
        `[refreshAccessTokenIfNeeded] Token refresh failed (non-fatal) for user ${userId}`,
        {
          error: ex.error,
          description: ex.description,
          status,
          message: err instanceof Error ? err.message : 'Unknown error',
        }
      );
      throw err;
    } finally {
      // Lock törlése
      refreshLocks.delete(userId);
    }
  })();

  refreshLocks.set(userId, refreshPromise);

  try {
    const result = await refreshPromise;
    return result.accessToken;
  } catch (err) {
    // GoogleReconnectRequiredError propagálása
    if (err instanceof GoogleReconnectRequiredError) {
      throw err;
    }
    // Egyéb hibák esetén null (nem disconnect)
    return null;
  }
}

/**
 * Google Calendar API hívás wrapper stabil hibakezeléssel
 * - Biztosít érvényes access tokent (refresh ha kell, single-flight lock-kal)
 * - API hívás retry-val (429/5xx/transport hibák, Retry-After header figyelembe vétele)
 * - 401 guard: max 1x refresh + 1x retry (végtelen ciklus elkerülése)
 */
export async function callGoogleCalendar<T>(
  userId: string,
  doRequest: (accessToken: string) => Promise<T>
): Promise<T> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Google Calendar credentials not configured');
  }

  // 1) Biztosítunk érvényes access tokent (refresh ha kell, single-flight lock-kal)
  let accessToken: string | null;
  try {
    accessToken = await refreshAccessTokenIfNeeded(userId);
  } catch (err) {
    if (err instanceof GoogleReconnectRequiredError) {
      // Reconnect szükséges, propagáljuk
      throw err;
    }
    throw new Error(`Failed to get access token: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  if (!accessToken) {
    throw new Error('Failed to get access token');
  }

  // 2) API hívás retry-val (429/5xx/transport hibák)
  try {
    return await withRetry(
      () => doRequest(accessToken!),
      {
        retries: 2,
        baseDelayMs: 400,
        maxDelayMs: 2500,
        shouldRetry: (err) => isRetryableTransportOrServer(err),
        onRetry: ({ attempt, delayMs, err, retryAfter }) => {
          const status = extractHttpStatus(err);
          console.warn(`[callGoogleCalendar] Retry ${attempt} for user ${userId}`, {
            delayMs,
            retryAfter,
            status,
          });
        },
      }
    );
  } catch (err: any) {
    const status = extractHttpStatus(err);

    // 3) Ha 401: egyszer próbálj refresh + újrahívást (végtelen ciklus elkerülése)
    if (status === 401) {
      console.warn(`[callGoogleCalendar] 401 error for user ${userId}; attempting one refresh then retry`);

      try {
        // Refresh próbálkozás
        const newAccessToken = await refreshAccessTokenIfNeeded(userId);
        if (!newAccessToken) {
          throw new Error('Failed to refresh access token after 401');
        }

        // Újrahívás új token-nel (csak 1x!)
        return await doRequest(newAccessToken);
      } catch (refreshErr) {
        // Ha refresh invalid_grant → reconnect required
        if (refreshErr instanceof GoogleReconnectRequiredError) {
          throw refreshErr;
        }
        // Ha még mindig 401 vagy más hiba → fail
        console.error(
          `[callGoogleCalendar] Auth loop guard: refresh after 401 failed for user ${userId}`,
          {
            refreshError: refreshErr instanceof Error ? refreshErr.message : 'Unknown error',
          }
        );
        throw new Error('Authentication failed after refresh attempt');
      }
    }

    // 403/404/409 stb. → nem token hiba, ne disconnect, csak fail
    throw err;
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

  // Ellenőrizzük a cache-t
  const cached = calendarCache.get(userId);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    // Cache érvényes, visszaadjuk a naptárakat
    return cached.calendars;
  }

  try {
    const result = await callGoogleCalendar(userId, async (accessToken) => {
      const oauth2Client = getOAuth2Client();
      if (!oauth2Client) {
        throw new Error('OAuth2 client not configured');
      }

      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const response = await calendar.calendarList.list();
      const calendars = response.data.items || [];

      return calendars.map((cal) => ({
        id: cal.id || '',
        summary: cal.summary || '',
      }));
    });

    // Cache-be mentjük
    calendarCache.set(userId, {
      calendars: result,
      expiresAt: now + CALENDAR_CACHE_TTL_MS,
    });

    console.log(`[listGoogleCalendars] Found ${result.length} calendars for user ${userId}`);
    return result;
  } catch (error) {
    // GoogleReconnectRequiredError propagálása
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

    console.error(`[listGoogleCalendars] Error listing Google Calendars for user ${userId}:`, error);
    if (error instanceof Error) {
      console.error(`[listGoogleCalendars] Error message: ${error.message}`);
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

    const eventId = await callGoogleCalendar(userId, async (accessToken) => {
      const oauth2Client = getOAuth2Client();
      if (!oauth2Client) {
        throw new Error('OAuth2 client not configured');
      }

      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

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
    });

    return eventId;
  } catch (error) {
    // GoogleReconnectRequiredError propagálása
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

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

    await callGoogleCalendar(userId, async (accessToken) => {
      const oauth2Client = getOAuth2Client();
      if (!oauth2Client) {
        throw new Error('OAuth2 client not configured');
      }

      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      await calendar.events.delete({
        calendarId: targetCalendarId,
        eventId: eventId,
      });
    });

    return true;
  } catch (error) {
    // GoogleReconnectRequiredError propagálása
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

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

    await callGoogleCalendar(userId, async (accessToken) => {
      const oauth2Client = getOAuth2Client();
      if (!oauth2Client) {
        throw new Error('OAuth2 client not configured');
      }

      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Először lekérjük a meglévő eseményt
      const existingEvent = await calendar.events.get({
        calendarId: calendarId,
        eventId: eventId,
      });

      if (!existingEvent.data) {
        throw new Error('Event not found');
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
    });

    return true;
  } catch (error) {
    // GoogleReconnectRequiredError propagálása
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

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
      const pageEvents = await callGoogleCalendar(userId, async (accessToken) => {
        const oauth2Client = getOAuth2Client();
        if (!oauth2Client) {
          throw new Error('OAuth2 client not configured');
        }

        oauth2Client.setCredentials({
          access_token: accessToken,
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const response: any = await calendar.events.list({
          calendarId: sourceCalendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 2500, // Max eredmények száma per oldal
          pageToken: pageToken,
        });

        return {
          items: response.data.items || [],
          nextPageToken: response.data.nextPageToken || undefined,
        };
      });

      allEvents = allEvents.concat(pageEvents.items);
      pageToken = pageEvents.nextPageToken;

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
    // GoogleReconnectRequiredError propagálása
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

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
    
    // Test database connection first
    try {
      await pool.query('SELECT 1');
    } catch (dbError) {
      const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
      console.error(`[syncTimeSlotsFromGoogleCalendar] Database connection test failed for user ${userId}:`, errorMsg);
      result.errors.push(`Database connection failed: ${errorMsg}`);
      throw new Error(`Database connection failed: ${errorMsg}`);
    }
    
    // Ellenőrizzük, hogy a felhasználó Google Calendar-hoz kapcsolva van-e
    let userResult;
    try {
      userResult = await pool.query(
        `SELECT id, email, google_calendar_source_calendar_id 
         FROM users 
         WHERE id = $1 AND google_calendar_enabled = true`,
        [userId]
      );
    } catch (dbError) {
      const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
      console.error(`[syncTimeSlotsFromGoogleCalendar] Error querying user ${userId}:`, errorMsg);
      result.errors.push(`Database query failed: ${errorMsg}`);
      throw new Error(`Database query failed: ${errorMsg}`);
    }
    
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
    let existingSlotsResult;
    try {
      existingSlotsResult = await pool.query(
        `SELECT id, google_calendar_event_id, start_time, status, teremszam 
         FROM available_time_slots 
         WHERE user_id = $1 AND source = 'google_calendar' AND google_calendar_event_id IS NOT NULL`,
        [userId]
      );
    } catch (dbError) {
      const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
      console.error(`[syncTimeSlotsFromGoogleCalendar] Error querying existing slots for user ${userId}:`, errorMsg);
      result.errors.push(`Database query failed: ${errorMsg}`);
      throw new Error(`Database query failed: ${errorMsg}`);
    }
    
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
              try {
                await pool.query(
                  `UPDATE available_time_slots 
                   SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP 
                   WHERE id = $${paramIndex}`,
                  values
                );
                result.updated++;
              } catch (dbError) {
                const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
                console.error(`[syncTimeSlotsFromGoogleCalendar] Error updating slot ${existingSlot.id} for user ${userId}:`, errorMsg);
                result.errors.push(`Failed to update slot ${existingSlot.id}: ${errorMsg}`);
              }
            }
          }
        }
      } else {
        // Új időpont létrehozása
        // cim-et nem állítjuk be (marad NULL, majd az API alapértelmezett értéket használ)
        try {
          await pool.query(
            `INSERT INTO available_time_slots (user_id, start_time, status, google_calendar_event_id, source, teremszam)
             VALUES ($1, $2, 'available', $3, 'google_calendar', $4)`,
            [userId, startTime.toISOString(), event.id, teremszam]
          );
          result.created++;
        } catch (dbError) {
          const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
          console.error(`[syncTimeSlotsFromGoogleCalendar] Error creating slot for event ${event.id} for user ${userId}:`, errorMsg);
          result.errors.push(`Failed to create slot for event ${event.id}: ${errorMsg}`);
        }
      }
    }
    
    // Töröljük azokat az időpontokat, amelyek már nincsenek a Google Calendar-ban
    for (const [eventId, slot] of Array.from(existingSlots.entries())) {
      if (!processedEventIds.has(eventId)) {
        // Csak akkor törölünk, ha nincs lefoglalva
        if (slot.status === 'available') {
          try {
            await pool.query(
              `DELETE FROM available_time_slots WHERE id = $1`,
              [slot.id]
            );
            result.deleted++;
          } catch (dbError) {
            const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
            console.error(`[syncTimeSlotsFromGoogleCalendar] Error deleting slot ${slot.id} for user ${userId}:`, errorMsg);
            result.errors.push(`Failed to delete slot ${slot.id}: ${errorMsg}`);
          }
        }
      }
    }
    
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`[syncTimeSlotsFromGoogleCalendar] Error syncing time slots from Google Calendar for user ${userId}:`, errorMessage);
    if (errorStack) {
      console.error(`[syncTimeSlotsFromGoogleCalendar] Error stack:`, errorStack);
    }
    
    // Check if it's a connection error
    if (errorMessage.includes('Connection terminated') || 
        errorMessage.includes('ECONNRESET') || 
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('Connection') ||
        errorMessage.includes('terminated')) {
      console.error(`[syncTimeSlotsFromGoogleCalendar] Connection error detected for user ${userId}`);
    }
    
    result.errors.push(`Sync error: ${errorMessage}`);
    // Don't throw - return partial results
    return result;
  }
}

